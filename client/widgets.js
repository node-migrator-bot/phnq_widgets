phnq_log.exec("widgets", function(log)
{
	var widgetClasses = {};
	var widgetTmpltFns = {};
	var requestedTypes = {};
	var nextIdIdx = 0;

	window.phnq_widgets =
	{
		config: {}, // this gets filled in from the server

		create: function(type, obj)
		{
			var widgetClass = widgetClasses[type] = phnq_core.clazz(obj || {});
			phnq_core.extend(widgetClass.prototype,
			{
				_ready: function()
				{
					if(this.ready)
						this.ready(this.get$$());
				},

				getElement: function()
				{
                	return this.elmntId ? document.getElementById(this.elmntId) : null;
				},

				"get$$": function()
				{
	                if(!this.$$)
	                {
	                    var _this = this;
	                    this.$$ = function(sel)
	                    {
	                        var widgetElmnt = _this.getElement();
	                        return $(sel||widgetElmnt, widgetElmnt);
	                    };
	                }
	                return this.$$;
				},

				find: function(type)
				{
					var found = [];
					this.get$$()(".winst").each(function()
					{
						var widgetObj = $(this).data("widget");
						if(widgetObj.type == type)
							found.push(widgetObj);
					});
					return found;
				},

				renderPartial: function(name, data)
				{
					var buf = [];
					var partialTmplt = this._partialTemplates[name];
					if(partialTmplt)
					{
						data = data instanceof Array ? data : [data];
						var partialFn = eval(partialTmplt);
						var dataLen = data.length;
						for(var i=0; i<dataLen; i++)
						{
							buf.push(partialFn(data[i]));
						}
					}
					else
					{
						throw "No partial named '"+name+"' in "+this.type;
					}
					return buf.join("");
				}
			});
		},

		scan: function(fn, newlyAdded)
		{
			var _this = this;
			var added = false;
			var toLoad = [];

			newlyAdded = newlyAdded || [];

			// Turn widget placeholders into widgets (markup only), or if no
			// markup available, add type to a list of types to load.
			$(".wph").each(function()
			{
				added = true;
				var wphElmnt = this;
				var type = $(wphElmnt).attr("class").split(/\s+/).pop();

				var tmpltFn = widgetTmpltFns[type];
				if(tmpltFn)
				{
					var markup = tmpltFn(
					{
						params: {},
						widget: function(type)
						{
							var wphBuf = [];
							wphBuf.push("<ul class=\"wph "+type+"\">");
							// params as <li>'s
							wphBuf.push("</ul>");
							return wphBuf.join("");
						},
						nextId: function()
						{
							return phnq_widgets.config.idPrefixClient + (nextIdIdx++);
						}
					});
                    $(wphElmnt).replaceWith(markup);
				}
				else
				{
					if(requestedTypes[type])
					{
	                    $(wphElmnt).replaceWith("<span class='loadError'>Error: "+type+"</span>");
					}
					else
					{
						toLoad.push(type);
					}
				}
			});

			// Widgets that have had their markup inserted, but not yet bound to
			// a widget object are tagged with the "widget" class. Bind these
			// elements to corresponding widget instances.
			$(".widget").each(function()
			{
				added = true;
				var widgetElmnt = this;
				var type = $(widgetElmnt).attr("class").split(/\s+/).pop();

				$(widgetElmnt).removeClass("widget");
				$(widgetElmnt).addClass("winst");

				var widgetClass = widgetClasses[type];
				if(widgetClass)
				{
					var widget = new widgetClass();
					widget.type = type;
					widget.elmntId = $(widgetElmnt).attr("id");
					$(widgetElmnt).data("widget", widget);
					newlyAdded.push(widget);
				}
			});

			// Load any widgets that need loading. If any widgets were added
			// above, or if any widgets needed loading then re-scan.
			this.load(toLoad, function()
			{
				if(added || toLoad.length > 0)
				{
					_this.scan(fn, newlyAdded);
				}
				else
				{
					$(newlyAdded).each(function()
					{
						this._ready();
					});
					if(fn)
						fn();
				}
			});
		},

		// Load required widgets.  It is possible for widgets to have been partially
		// loaded. Widgets that are loaded as part of the initial page load will not
		// have markup templates available. So, the types to be loaded are sorted
		// into two lists: 1) needing template only, and 2) needing full load.
		load: function(types, fn)
		{
			if(types.length == 0)
				return fn();

			var allTypes = [];
			for(var type in widgetClasses)
			{
				allTypes.push(type);
			}
			for(var type in widgetTmpltFns)
			{
				allTypes.push(type);
			}

			var classesOnly = [];
			var fullyLoaded = [];
			for(var i=0; i<allTypes.length; i++)
			{
				var type = allTypes[i];
				if(widgetTmpltFns[type])
					fullyLoaded.push(type);
				else
					classesOnly.push(type);
			}

			// TODO: Make this absolute to allow cross-domain loading...
            $.getJSON(phnq_widgets.config.uriPrefix+"/load?jsoncallback=?",
            {
            	t: types.join(","), // types to load
                co: classesOnly.join(","), // currently loaded (classes only)
                fl: fullyLoaded.join(",") // currently loaded (fully)
            }, function(res)
            {
            	// add templates
            	for(var type in res.templates)
            	{
            		widgetTmpltFns[type] = eval(res.templates[type]);
            	}

            	// Add CSS to page
            	var style = res.styles.join("");
            	if(style)
	        		$("head").append("<style type='text/css'>"+style+"</style>");

            	// Evaluate scripts
            	var script = res.scripts.join("");
            	if(script)
            		eval(script);

                fn();
            });
		}
	};

	$(function()
	{
		phnq_widgets.scan();
	});

	window.depend = function()
	{
		// not needed on client...
	};


	(function($)
	{
		var methods =
		{
			set: function(type, params, fn)
			{
				var buf = [];
				var paramsArr = params instanceof Array ? params : [params];
				var numParams = paramsArr.length;

				for(var i=0; i<numParams; i++)
				{
					var pObj = paramsArr[i];
					buf.push("<ul class=\"wph "+type+"\">");
					for(var k in pObj)
					{
						buf.push("<li name=\""+k+"\">"+pObj[k]+"</li>");
					}
					buf.push("</ul>");
				}

				log.debug("BBB: ", buf.join(""));

				this.each(function()
				{
					$(this).html(buf.join(""));
				});

				phnq_widgets.scan(fn);
			}
		};

		$.fn.widgets = function(method)
		{
			if( methods[method])
			{
				return methods[method].apply( this, Array.prototype.slice.call(arguments, 1));
			}
			else if (typeof method === 'object' || ! method)
			{
				return methods.init.apply(this, arguments);
			}
			else
			{
				$.error('Method ' +  method + ' does not exist on jQuery.widgets');
			}    
		};
	})(jQuery);
});
