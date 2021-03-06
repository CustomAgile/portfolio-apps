Ext.define("portfolio-sankey-graph", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    logger: new Rally.technicalservices.Logger(),
    fetch: ['Name', 'PlanEstimate', 'Predecessors', 'Successors', 'Blocked', 'BlockedReason', 'ScheduleState', 'DisplayColor'],
    notInDatasetColor: '#000000',
    autoScroll: false,
    margin: 25,

    launch: function() {
        Rally.technicalservices.WsapiToolbox.fetchPortfolioItemTypes().then({
            success: function(types){
                this.portfolioItemTypes = types;
                this.addComponents();
            },
            scope: this
        });
    },
    getHeader: function(){
        this.logger.log('getHeader');
        return this.headerContainer;
    },
    getBody: function(){
        return this.displayContainer;
    },
    addComponents: function(){
        this.logger.log('addComponents');

        this.removeAll();

        this.headerContainer = this.add({xtype:'container',itemId:'header-ct', layout: {type: 'hbox'}});
        this.displayContainer = this.add({xtype:'container',itemId:'body-ct', tpl: '<tpl>{message}</tpl>'});

        if ( this.getSetting('showScopeSelector') || this.getSetting('showScopeSelector') == "true" ) {
            this.getHeader().add({
                xtype: 'portfolioitemselector',
                context: this.getContext(),
                type: this.getSetting('selectorType'),
                stateId: this.getContext().getScopedStateId('app-selector'),
                width: '75%',
                listeners: {
                    change: this._update,
                    scope: this
                }
            });
        } else {
            this._addWaitingForSelectionContainer();
            this.subscribe(this, 'portfolioItemSelected', this._update, this);
            this.publish('requestPortfolioItem', this);
        }
    },
    _addWaitingForSelectionContainer: function(){

        var me = this;
        if (this.down('#sankey-container')){
            this.down('#sankey-container').destroy();
        }

       this.add({
            xtype: 'container',
            itemId: 'sankey-container',
            padding: 50,
            html: '<div class="message">No Portfolio Item selected. <a href="#">Try Again</a></div>',
            listeners: {
                scope: this,
                render: function(component) {
                    var link = component.getEl().down('a');
                    link.on('click', function(e) {
                        me.publish('requestPortfolioItem', this);
                    });
                }
            }
        });
    },
    _update: function(portfolioItem){
        this.logger.log('_update', portfolioItem);
        if (this.down('#sankey-container')){
            this.down('#sankey-container').destroy();
        }

        this.nodes = [];
        this.links = [];
        this.oidMap = {};
        this.noPred = 0;
        this.noSuc = 0;

        if (portfolioItem){
            this.loadDataWS(portfolioItem);
        }
    },
    getPortfolioItemTypePaths: function(){
        this.logger.log('getPortfolioItemTypePaths', this.portfolioItemTypes);
        return _.map(this.portfolioItemTypes, function(p){ return p.typePath.toLowerCase(); });
    },
    getPortfolioItemNameField: function(){
        return this.portfolioItemTypes[0].typePath.split('/').slice(-1)[0];
    },
    _getFilters: function(portfolioItem){

        var idx = _.indexOf(this.getPortfolioItemTypePaths(), portfolioItem.get('_type').toLowerCase());
        var property = [this.getPortfolioItemNameField()];
        for (var i=0; i<idx; i++){ property.push("Parent")}
        property = property.join(".");

        this.logger.log('_getFilters', portfolioItem, property);

        return [{
            property: property,
            value: portfolioItem.get('_ref')
        }];
    },
    _makeDataObj: function (rec, notInDataset) {

        var displayColor = rec.get('DisplayColor') || '#00A9E0';
        if (notInDataset){
            displayColor = this.notInDatasetColor;
        }

        return {
            oid: rec.get('ObjectID'),
            name: rec.get('Name'),
            size: rec.get('PlanEstimate'),
            blocked: rec.get('Blocked'),
            displayColor: displayColor,
            ref: '/hierarchicalrequirement/' + rec.get('ObjectID')
        };
    },


    loadDataWS: function (release) {
        var me = this;
        var wss = Ext.create('Rally.data.wsapi.Store', {
            model: 'UserStory',
            autoLoad: false,
            fetch: this.fetch,
            filters: this._getFilters(release),
            limit: Infinity
        });

        wss.load({
            scope: this,
            callback: function (records, options, success) {
                this.logger.log('loadDataWS', records);

                var filteredRecords = _.filter(records, function(r){
                    return r.data.Predecessors.Count + r.data.Successors.Count;
                });

                var predecessorsNotInDataset = [],
                    dataSetOids = _.map(records, function(r){ return r.get('ObjectID')});

                var promises = _.map(filteredRecords, function(fr){
                    var ret = [];
                    var t = fr.get('ObjectID');

                    if (fr.data.Predecessors.Count) {
                        ret.push(fr.getCollection('Predecessors').load({fetch: me.fetch}).then(function (preds) {

                            _.each(preds, function (s) {
                                if (!Ext.Array.contains(dataSetOids, s.get('ObjectID'))){
                                    predecessorsNotInDataset.push(s);
                                }
                                me.links.push({source: s.get('ObjectID'), target: t, link: 1});

                            });
                            return true;
                        }));
                    }

                    return ret;
                }, this);

                promises =_.flatten(promises);

                this.logger.log('processed records', promises);

                if (promises.length > 0){
                    Deft.Promise.all(promises).then(function(){
                        _.each(filteredRecords, function(fr){
                            this.nodes.push(this._makeDataObj(fr));
                            this.oidMap[fr.get('ObjectID')] = this.nodes.length - 1;
                        }, me);

                        _.each(predecessorsNotInDataset, function(p){
                            this.nodes.push(this._makeDataObj(p, true));
                            this.oidMap[p.get('ObjectID')] = this.nodes.length -1;
                        }, me);

                        me.logger.log('oidMap', me.oidMap);

                        me.links = _.map(me.links, function(l){
                            return { source: me.oidMap[l.source], target: me.oidMap[l.target], value: 1 };
                        });

                        me.links = _.filter(me.links, function(l){
                            return _.isNumber(l.source) && _.isNumber(l.target);
                        });

                        me.logger.log('links', me.links);
                        me.render();

                    });
                } else {
                    this.add({
                        xtype: 'container',
                        itemId: 'sankey-container',
                        html: 'No predecessor or successor data for the selected Release'
                    });
                }

            }
        });
    },

    render: function () {
        var w = this.getWidth(),
            h = this.getHeight(),
            t = (this.noPred > this.noSuc) ? this.noPred : this.noSuc;

        if (t * 32 > h) { h = (t + 2) * 32; }

        var margin = {top: 1, right: 1, bottom: 6, left: 1},
            width = w - margin.left - margin.right,
            height = h - margin.top - margin.bottom;

        this.logger.log('render', margin,width,height);
        var formatNumber = d3.format(",.0f"),
            format = function(d) { return formatNumber(d) + " SP"; },
            color = function (c) { return c; };

        this.logger.log('formatNumber', formatNumber);
        var test = this.add({
            xtype: 'container',
            itemId: 'sankey-container'
        });

        var svg = d3.select(test.getEl().dom).append('svg')
            .attr("width", width + margin.left + margin.right)
            .attr("height", height + margin.top + margin.bottom)
            .append("g")
            .attr("transform", "translate(" + margin.left + "," + margin.top + ")");
        this.logger.log('svg', svg);

        var sankey = d3.sankey()
            .size([width, height])
            .nodeWidth(15)
            .nodePadding(10)
            .nodes(this.nodes)
            .links(this.links)
            .layout(32);

        this.logger.log('sankey', sankey);

        var path = sankey.link();

        var link = svg.append("g").selectAll(".link")
            .data(this.links)
            .enter().append("path")
            .attr("class", function (d) { return d.source.blocked ? "blocked" : "link"; })
            .attr("d", path)
            .style("stroke-width", function(d) { return Math.max(1, d.dy); })
            .sort(function(a, b) { return b.dy - a.dy; });

        link.append("title")
            .text(function(d) { return d.source.name + " ???  " + d.target.name; });

        var node = svg.append("g").selectAll(".node")
            .data(this.nodes)
            .enter().append("g")
            .attr("class", "node")
            .attr("transform", function(d) { return "translate(" + d.x + "," + d.y + ")"; })
            .call(d3.behavior.drag()
                .origin(function(d) { return d; })
                .on("dragstart", function() { this.parentNode.appendChild(this); })
                .on("drag", dragmove));

        node.append("rect")
            .attr("height", function(d) { return d.dy; })
            .attr("width", sankey.nodeWidth())
            .style("fill", function(d) { return d.color = color(d.displayColor); })
            .style("stroke", function(d) { return d3.rgb(d.color).darker(2); })
            .append("title")
            .text(function(d) { return d.name + "\n" + format(d.size); });

        node
            .on('dblclick', function (d) { Rally.nav.Manager.showDetail(d.ref); });

        node.append("text")
            .attr("x", -6)
            .attr("y", function(d) { return d.dy / 2; })
            .attr("dy", ".35em")
            .attr("text-anchor", "end")
            .attr("transform", null)
            .text(function(d) { return Ext.util.Format.ellipsis(d.name, 60, true); })
            .filter(function(d) { return d.x < width / 2; })
            .attr("x", 6 + sankey.nodeWidth())
            .attr("text-anchor", "start");

        function dragmove(d) {
            d3.select(this).attr("transform", "translate(" + d.x + "," + (d.y = Math.max(0, Math.min(height - d.dy, d3.event.y))) + ")");
            sankey.relayout();
            link.attr("d", path);
        }
    },

    getOptions: function() {
        return [
            {
                text: 'About...',
                handler: this._launchInfo,
                scope: this
            }
        ];
    },

    _launchInfo: function() {
        if ( this.about_dialog ) { this.about_dialog.destroy(); }
        this.about_dialog = Ext.create('Rally.technicalservices.InfoLink',{});
    },

    isExternal: function(){
        return typeof(this.getAppId()) == 'undefined';
    },
    //onSettingsUpdate:  Override
    onSettingsUpdate: function (settings){
        this.logger.log('onSettingsUpdate',settings);
        Ext.apply(this, settings);
        this.addComponents();
    },
    getSettingsFields: function() {
        return Rally.technicalservices.PortfolioItemSankeyGraph.getFields(this.getContext());
    }
});
