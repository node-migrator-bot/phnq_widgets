require("phnq_log").exec("widget", function(log)
{
	var phnq_core = require("phnq_core");
	var phnq_ejs = require("phnq_ejs");
	var _path = require("path");
	var _fs = require("fs");
	var config = require("./config");
	var _ = require("underscore");

	var URL_REGEX = /url\("?([^)\"]*)"?\)/g;
	var EMPTY_TAGS = ["base", "basefont", "br", "col", "frame", "hr", "img", "input", "link", "meta", "param"];

	module.exports = phnq_core.clazz(
	{
		init: function(dir)
		{
			this.type = _path.basename(dir);
			this.dir = dir;
			this.partials = {};
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
						script: rawScript,
						partialTemplates: JSON.stringify(_this.getCompiledPartials())
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
				this.style = phnq_core.trimLines((this.getFileData("css") || "").replace(/__CLASS__/g, this.type.replace(/\./g, "\\.")));

				var buf = [];
				var m;
				var idx = 0;
				while((m = URL_REGEX.exec(this.style)))
				{
					buf.push(this.style.substring(idx, m.index));
					var url = m[1];
					if(!url.match(/^(\/|data:|https?:)/))
					{
						url = config.uriPrefix + "/" + this.type + "/" + url;
					}
					buf.push("url("+url+")");
					idx = URL_REGEX.lastIndex;
				}
				buf.push(this.style.substring(idx));
				this.style = buf.join("");
			}
			return this.style;
		},

		getCompiledMarkup: function()
		{
			if(!this.compiledMarkup)
			{
				this.compiledMarkup = this.compileTemplate(this.getFileData("ejs"), "<%=nextId()%>", ["widget", this.type]);
			}
			return this.compiledMarkup;
		},

		getCompiledPartials: function()
		{
			if(!this.compiledPartials)
			{
				this.compiledPartials = {};
				for(var k in this.partials)
				{
					var ejs = _fs.readFileSync(this.partials[k], "UTF-8");
					this.compiledPartials[k] = this.compileTemplate(ejs);
				}
			}
			return this.compiledPartials;
		},

		compileTemplate: function(ejs, id, classesExt)
		{
			var _this = this;
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
					if(classesExt)
					{
						var classes = (node.attributes["class"] || "").trim().split(/\s+/);
						for(var i=0; i<classesExt.length; i++)
						{
							classes.push(classesExt[i]);
						}
						node.attributes["class"] = classes.join(" ").trim();
					}

					if(id)
					{
						var idAttr = node.attributes["id"];
						if(!idAttr)
						{
							node.attributes["id"] = id;
						}
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
				if(bufLen == buf.length && _.include(EMPTY_TAGS, tagName))
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

			return phnq_ejs.compile(ejs);
		},

		getDependencies: function()
		{
			if(!this.dependencies)
			{
				var deps = [];

				// TODO: this does not completely work -- if any calls to widget() are
				// nested within some condition then, depending on the condition, the
				// the widget() function may not get called nor, thus, intercepted. The
				// result is that embedded widgets may not be recognized as dependencies.
				// Might need to use regex to extract dependencies in templates.

				/*
				*	Dependencies from markup
				*	Run the compiled markup function and intercept the calls to
				*	widget(type).
				*/
				var markupFn = eval(this.getCompiledMarkup());
				var idIdx = 0;
				markupFn(
				{
					query: {},
					params: {},
					widget: function(type, params)
					{
						params = params || {};
						var isLazy = !!params._lazy;

						if(!isLazy)
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

				try
				{
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
				}
				catch(ex)
				{
					log.error(ex);
				}

				// add dependents' dependencies
				var depDeps = [];
				for(var i=0; i<deps.length; i++)
				{
					var depWidget = require("./widget_manager").instance().getWidget(deps[i]);
					if(depWidget)
						depDeps = _.union(depDeps, depWidget.getDependencies());
				}

				this.dependencies = _.uniq(_.union(deps, depDeps));
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
			var widgetManager = require("./widget_manager").instance();

			// Get Markup -- includes dependencies
			var markupFn = eval(this.getCompiledMarkup());
			var markup = markupFn(context);

			var types = this.getDependencies();
			types.push(this.type);
			_.each(context.embedded, function(type)
			{
				types.push(type);
			});
			types = _.uniq(types);
			var typesLen = types.length;

			// find the external scripts
			var extScriptBuf = [];
			for(var i=0; i<typesLen; i++)
			{
				var type = types[i];
				if(type.match(/^https?:/))
				{
					extScriptBuf.push("<script type='text/javascript' src='"+type+"'></script>");
				}
			}

			var inlineScript = config.inlineScript ? widgetManager.getAggregatedScript(types) : null;
			var inlineStyle = config.inlineStyle ? widgetManager.getAggregatedStyle(types) : null;
			var aggScript = config.inlineScript ? null : widgetManager.getAggregatedScriptName(types);
			var aggStyle = config.inlineStyle ? null : widgetManager.getAggregatedStyleName(types);

			var shellFn = getCompiledShellMarkupTemplate();
			var shellCode = shellFn(
			{
				title: title,
				prefix: config.uriPrefix,
				body: markup,
				extScript: extScriptBuf.join(""),
				inlineScript: inlineScript,
				inlineStyle: inlineStyle,
				aggScript: aggScript,
				aggStyle: aggStyle,
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
