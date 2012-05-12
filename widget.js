require("phnq_log").exec("widget", function(log)
{
	var phnq_core = require("phnq_core");
	var phnq_ejs = require("phnq_ejs");
	var _path = require("path");
	var _fs = require("fs");
	var config = require("./config");
	var _ = require("underscore");

	module.exports = phnq_core.clazz(
	{
		init: function(dir)
		{
			this.type = _path.basename(dir);
			this.dir = dir;
			log.debug("discovered widget: ", this.type);
		},

		getScript: function()
		{
			if(this.script === undefined)
			{
				var _this = this;
				var rawScript = this.getFileData("js");
				if(rawScript)
				{
					var scriptTmplt = getCompiledScriptTemplate();
					this.script = phnq_core.trimLines(scriptTmplt(
					{
						type: _this.type,
						script: rawScript
					}));
				}
				else
				{
					this.script = "";
				}
			}
			return this.script;
		},

		getStyle: function()
		{
			if(this.style === undefined)
			{
				this.style = phnq_core.trimLines((this.getFileData("css") || "").replace(/SELF_CLASS/g, this.type.replace(/\./g, "\\.")));
			}
			return this.style;
		},

		getCompiledMarkup: function()
		{
			if(!this.compiledMarkup)
			{
				var _this = this;
				var ejs = this.getFileData("ejs");
				var sax = require("sax");
				var parser = sax.parser(true);
				var buf = [];
				var bufLen = 0;
				var rootTag = true;

				parser.onopentag = function(node)
				{
					if(rootTag)
					{
						_this.rootTagName = node.name;
						var classes = (node.attributes["class"] || "").trim().split(/\s+/);
						classes.push("widget");
						classes.push(_this.type); // type must be the last class -- it's how the type is determined on the client.
						node.attributes["class"] = classes.join(" ").trim();

						var idAttr = node.attributes["id"];
						if(!idAttr)
						{
							node.attributes["id"] = "<%=nextId()%>";
						}
					}

					buf.push("<"+node.name);
					for(var k in node.attributes)
					{
						var v = _this.absolutizePathIfNeeded("", node.name, k, node.attributes[k]);
						buf.push(" "+k+"=\""+v+"\"");
					}
					buf.push(">");
					bufLen = buf.length;
					rootTag = false;
				};

				parser.onclosetag = function(tagName)
				{
					if(bufLen == buf.length)
					{
						buf.pop();
						buf.push("/>");
					}
					else
					{
						buf.push("</"+tagName+">");
					}
				};

				parser.ontext = function(text)
				{
					buf.push(text);
				};

				parser.write(ejs);

				ejs = buf.join("");

				this.compiledMarkup = phnq_ejs.compile(ejs);
			}
			return this.compiledMarkup;
		},

		getDependencies: function()
		{
			if(!this.dependencies)
			{
				var deps = [];

				/*
				*	Dependencies from markup
				*	Run the compiled markup function and intercept the calls to
				*	widget(type).
				*/
				var markupFn = eval(this.getCompiledMarkup());
				var idIdx = 0;
				markupFn(
				{
					params: {},
					widget: function(type, options)
					{
						options = options || {};
						options.lazy = !!options.lazy;

						if(!options.lazy)
						{
							var depWidget = require("./widget_manager").instance().getWidget(type);
							if(depWidget)
							{
								var nestedDeps = depWidget.getDependencies();
								for(var i=0; i<nestedDeps.length; i++)
								{
									deps.push(nestedDeps[i]);
								}
								deps.push(type);
							}
						}
					},
					nextId: function()
					{
						return "id_"+(idIdx++);
					}
				});

				var rawScript = this.getFileData("js");
				var rawScriptWrapperFn = eval(
					"(function(context){ with(context){ try{" +
					rawScript +
					"}catch(ex){}}})"
				);
				rawScriptWrapperFn({
					depend: function(type)
					{
						deps.push(type);
					}
				});

				this.dependencies = _.uniq(deps);
			}
			return this.dependencies;
		},

		getFileData: function(ext)
		{
			if(!this[ext+"File"])
				return null;

			return _fs.readFileSync(this[ext+"File"], "UTF-8");
		},

		absolutizePathIfNeeded: function(tagUri, tagName, attrName, attrValue)
		{
			switch(tagUri + ":" + tagName+":"+attrName)
			{
				case ":img:src":
					return config.uriPrefix + "/" + this.type + "/" + attrValue;
					break;
			}
			return attrValue;
		},

		getWidgetShellCode: function(context)
		{
			var title = this.type;

			// Get Markup -- includes dependencies
			var markupFn = eval(this.getCompiledMarkup());
			var markup = markupFn(context);

			var types = this.getDependencies();
			types.push(this.type);
			var typesLen = types.length;

			// Aggregate the scripts and styles
			var scriptBuf = [];
			var styleBuf = [];
			var extScriptBuf = [];
			for(var i=0; i<typesLen; i++)
			{
				var type = types[i];
				if(type.match(/^https?:/))
				{
					extScriptBuf.push("<script type='text/javascript' src='"+type+"'></script>");
				}
				else
				{
					try
					{
						var depWidget = require("./widget_manager").instance().getWidget(type);
						scriptBuf.push(depWidget.getScript());
						styleBuf.push(depWidget.getStyle());
					}
					catch(ex)
					{
						log.error("Error loading dependency: ", type);
					}
				}
			}

			var shellFn = getCompiledShellMarkupTemplate();
			var shellCode = shellFn(
			{
				title: title,
				prefix: config.uriPrefix,
				body: markup,
				extScript: extScriptBuf.join(""),
				script: scriptBuf.join(""),
				style: styleBuf.join(""),
				widget: this
			});

			return shellCode;
		}
	});

	var compiledShellMarkupTemplate = null;
	var getCompiledShellMarkupTemplate = function()
	{
		if(!compiledShellMarkupTemplate)
		{
			compiledShellMarkupTemplate = eval(phnq_ejs.compile(_fs.readFileSync(__dirname+"/shell.html.ejs", "UTF-8"))); 
		}
		return compiledShellMarkupTemplate;
	};

	var compiledScriptTemplate = null;
	var getCompiledScriptTemplate = function()
	{
		if(!compiledScriptTemplate)
		{
			compiledScriptTemplate = eval(phnq_ejs.compile(_fs.readFileSync(__dirname+"/script.js.ejs", "UTF-8"))); 
		}
		return compiledScriptTemplate;
	};
});
