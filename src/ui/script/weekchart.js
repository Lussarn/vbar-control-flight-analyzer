const d3 = require('d3');

function WeekChart (weekChartId, weekChartLegendId, modelId, batteryId, dateStart, dateEnd, groupAs) {
	// Keep reference to main object in this
	self = this;

	// Model Id
	self.modelId = modelId;

	// Battery Id
	self.batteryId = batteryId;

	// Start date
	self.dateStart = dateStart;

	// End date
	self.dateEnd = dateEnd;

	// Group as
	self.groupAs = groupAs;

	// Bar colors
	self.colors = [
		"#4D4D4D",
		"#5DA5DA",
		"#FAA43A",
		"#60BD68",
		"#F17CB0",
		"#B2912F",
		"#B276B2",
		"#DECF3F",
		"#F15854",
		"#1f77b4",
		"#ff7f0e",
		"#2ca02c",
		"#d62728",
		"#9467bd",
		"#8c564b",
		"#e377c2",
		"#7f7f7f",
		"#bcbd22",
		"#17becf"
	];


	self.z = d3.scaleOrdinal().range(self.colors);

	// Setup chart and legend SVG
	self.svg = d3.select(weekChartId);
	self.svgLegend = d3.select(weekChartLegendId);

	// Setup margins
	self.margin = {
		top: parseInt(self.svg.style("top")),
		right: 60,
		bottom: parseInt(self.svg.style("bottom")),
		left: 60
	};

	// Update UI
	self.updateUI = function() {
		// Setup geometry
		self.width = parseInt(self.svg.style("width")) - self.margin.left - self.margin.right,
		self.height = parseInt(self.svg.style("height")) - self.margin.top - self.margin.bottom;

		// Remove graph if present
		self.svg.selectAll("*").remove();
		self.svgLegend.selectAll("*").remove();

		g = self.svg.append("g").attr("transform", "translate(" + self.margin.left + "," + self.margin.top + ")");
		gLegend = self.svgLegend.append("g");

		self.x = d3.scaleBand()
			.rangeRound([0, self.width])
			.padding(0.1)
			.align(0.1);

		self.y = d3.scaleLinear()
			.rangeRound([self.height, 0]);

		self.x.domain(weeks.map(function(d) { return d; }));
		self.y.domain([0, d3.max(self.weekTotals) < 10 ? 10 : d3.max(self.weekTotals)]);

		self.line = d3.line()
			.x(function(d) { return x(d.x); })
			.y(function(d) { return y(d.y); });

		// add the Y gridlines
		g.append("g")
			.attr("class", "grid axis axis--y")
			.call(d3.axisLeft(self.y).ticks(10).tickSize(-self.width).tickFormat(""));

		// Bars
		g.selectAll(".serie")
			.data(d3.stack().keys(models)(self.cycles))
			.enter().append("g")
				.attr("class", "serie")
				.attr("fill", function(d) { return self.z(d.key); })
			.selectAll("rect")
			.data(function(d) { return d; })
			.enter().append("rect")
				.attr("x", function(d, i) { return self.x(weeks[i]); })
				.attr("y", function(d) { return self.y(d[1]); })
				.attr("height", function(d) { return self.y(d[0]) - self.y(d[1]); })
				.attr("width", self.x.bandwidth());


		// X Axis
		g.append("g")
			.attr("class", "axis axis--x")
			.attr("transform", "translate(0," + self.height + ")")
			.call(d3.axisBottom(self.x))
			.selectAll("text")
				.style("text-anchor", "start")
				.attr("transform", "translate(13, 0) rotate (90) translate(10, 0)");

		// Y Axis
		g.append("g")
			.attr("class", "axis axis--y")
			.call(d3.axisLeft(self.y).ticks(10, "s").tickFormat(d3.format('d')))
		.append("text")
			.attr("transform", "translate(-40, " + (self.height / 2)+ ") rotate (-90) ")
			.attr("text-anchor", "start")
			.attr("fill", "#000")
			.text("Cycles");


		// Legend
		var legend = gLegend.selectAll(".legend")
			.data(models)
			.enter().append("g")
				.attr("class", "legend")
				.attr("transform", function(d, i) { return "translate(0," + i * 30 + ")"; })
				.style("font", "20px 'LiberationSans'");

		legend.append("rect")
			.attr("x", 270)
			.attr("width", 28)
			.attr("height", 28)
			.attr("fill", self.z);

		legend.append("text")
			.attr("x", 260)
			.attr("y", 14)
			.attr("dy", ".35em")
			.attr("text-anchor", "end")
			.text(function(d) { return d; });

	}
};

WeekChart.prototype.load = function() {
	var self = this;
	backend.getWeeks(self.modelId, self.batteryId, self.dateStart, self.dateEnd, self.groupAs, function(err, data) {
		if (err) throw error;

		models = [];
		weeks = [];
		var weekGroups = {};
		data.map(function(week) {
			weeks.push(week.week);
			weekGroups[week.week] = week.groups;
			Object.keys(week.groups).map(function(model, i) {
				if (!models.includes(model)) models.push(model);
			});
		});

		self.cycles = [];
		self.weekTotals = [];
		weeks.map(function(week) {
			var dateCycle = {}
			var weekTotal = 0;
			for (i = 0; i < models.length; i++) {
				dateCycle[models[i]] = (typeof weekGroups[week][models[i]] === "undefined") ? 0 : weekGroups[week][models[i]];
				weekTotal += dateCycle[models[i]];
			}
			self.cycles.push(dateCycle);
			self.weekTotals.push(weekTotal);
		});

		self.z.domain(models);

		d3.select(window).on('resize', self.updateUI);
		self.updateUI();
	});
}

module.exports = WeekChart;
