require('dotenv').config();
const md5 = require("md5");
const fs = require('fs');
const path = require("path");
const inflector = require("../helper/inflector");
const _ = require("lodash");
const connectionStringParser = require("../helper/connection-string-parser");
const SchemaModel = require("../model/SchemaModel");
const FieldModel = require("../model/FieldModel")

//used to format output
const stt = require('spaces-to-tabs');
const stringify = require("stringify-object");

let sourceBase = path.resolve(__dirname + "/../../");

let templatePath = path.resolve(__dirname + "/templates");

let schemaBase = sourceBase + "/schema";
//console.log(schemaBase);
if (!fs.existsSync(schemaBase)) {
	fs.mkdirSync(schemaBase);
}

let fieldBase = schemaBase + "/fields";
//console.log(fieldBase);
if (!fs.existsSync(fieldBase)) {
	fs.mkdirSync(fieldBase);
}

let validationBase = schemaBase + "/validation";
//console.log(validationBase);
if (!fs.existsSync(validationBase)) {
	fs.mkdirSync(validationBase);
}

let modelBase = sourceBase + "/model";
//console.log(modelBase);
if (!fs.existsSync(modelBase)) {
	fs.mkdirSync(modelBase);
}

let controllerBase = sourceBase + "/controller";
//console.log(controllerBase);
if (!fs.existsSync(controllerBase)) {
	fs.mkdirSync(controllerBase);
}

let routerBase = sourceBase + "/router";
//console.log(routerBase);
if (!fs.existsSync(routerBase)) {
	fs.mkdirSync(routerBase);
}


async function convert(destination, connectionString, options) {

	options = options || {};

	let schemaModel = new SchemaModel();
	//schemaModel.createTable(); //TODO do this only once

	let fieldModel = new FieldModel();
	//FieldModel.createTable(); //TODO do this only once

	let converter;
	let schemas = [];

	if (!connectionString) {
		connectionString = [process.env.DEFAULT_DB]
	} else if (!_.isArray(connectionString)) {
		connectionString = [connectionString];
	}

	let cs;

	for (let i = 0; i < connectionString.length; i++) {

		cs = connectionString[i];
		let pool;

		if (cs.indexOf("postgresql") === 0) {
			converter = require("./pg-tables-to-schema");
			pool = await require("../helper/postgres-pool")(connectionString[i]);
		} else if (cs.indexOf("mysql") === 0) {
			converter = require("./mysql-tables-to-schema");
			pool = await require("../helper/mysql-pool")(connectionString[i]);
		} else if (cs.indexOf("mssql") === 0) {
			converter = require("./mssql-tables-to-schema");
			let p = require("../helper/mssql-pool")
			pool = await p(connectionString[i]);
		} //TODO elastic?


		cs = connectionStringParser(cs);

		console.log(cs);

		let schema = await converter(
			_.extend({
				baseUrl: '',
				indent: 2,
				dbName: cs.database,
				connectionString: cs
			}, options), pool);


		schema.forEach(
			function (item) {
				item.dataSource = cs.database;
				schemas.push(item);
			}
		)
	}


	// Schema's is an array of json-schema objects
	//
	let routers = [];
	let schemaHash = {};

	for (let q = 0; q < schemas.length; q++) {
		let item = schemas[q];

		if (item.tableName.indexOf("_") === 0) { //private tables
			//continue;
		}

		let name = item.tableName;

		if (options.removePrefix) {
			if (_.isString(options.removePrefix)) {
				options.removePrefix = [options.removePrefix]
			}
			options.removePrefix.forEach(
				function(item) {
					let tempName = name.split(item).join("");
					if (!schemaHash[tempName]) {
						name = tempName;
					}
				}
			)
		}

		if (schemaHash[name]) {
			name += name + "-" + cs.database
		}

		schemaHash[name] = item;

		item.title = inflector.titleize(name);

		let keys = [];
		let properties = {};
		let primaryKey = item.primaryKey || "id";
		if (primaryKey === '') {
			primaryKey = 'id';
		}

		for (let key in item.properties) {
			let k = inflector.camelize(inflector.underscore(key), false);
			if (k.length === 2) {
				k = k.toLowerCase();
			}
			properties[k] = _.clone(item.properties[key]);
			properties[k].columnName = key;
			keys.push(k);
		}

		for (let i = 0; i < item.required.length; i++) {
			let k = inflector.camelize(item.required[i], false);
			if (k.length === 2) {
				k = k.toLowerCase();
			}
			item.required[i] = k;
		}

		keys = _.uniq(keys);
		keys.sort();
		let filtered = keys.filter(
			(value, index, arr) => {
				if (value === item.primaryKey ||
					value === "createdAt" ||
					value === "updatedAt" ||
					value === "name"
				) {
					return false
				}
				return true;
			}
		);

		if (keys.indexOf("name") !== -1) {
			filtered.unshift("name")
		}
		filtered.unshift(item.primaryKey);

		if (keys.indexOf("createdAt") !== -1) {
			filtered.push("createdAt")
		}
		if (keys.indexOf("updatedAt") !== -1) {
			filtered.push("updatedAt")
		}

		keys = filtered;

		item.properties = properties;

		let schemaName = schemaBase + "/" + inflector.dasherize(name).toLowerCase() + "-schema";
		let validationPath = validationBase + "/" + inflector.dasherize(name).toLowerCase() + "-validation.js";
		let fieldPath = fieldBase + "/" + inflector.dasherize(name).toLowerCase() + "-fields.js";
		let modelPath = modelBase + "/" + inflector.classify(name) + "Model.js";
		let controllerPath = controllerBase + "/" + inflector.classify(name) + "Controller.js";
		let routerPath = routerBase + "/" + inflector.dasherize(name).toLowerCase() + "-router.js";

		let tableName = item.tableName;
		//TODO need to remove schemas that no longer exist
		if (destination !== "file") {
			let result = await schemaModel.set(item.tableName, item);
		}

		let fields = await fieldModel.get(tableName);

		let fieldSchema = {
			title: inflector.titleize(item.tableName),
			tableName: item.tableName,
			dataSource: item.dataSource,
			adminIndex: [],
			adminCreate: [],
			adminRead: [],
			adminUpdate: [],
			publicIndex: [],
			publicCreate: [],
			publicRead: [],
			publicUpdate: [],
			status: "active"
		};

		let keysSorted = _.clone(keys);

		if (!fields) {
			keysSorted.forEach(
				function (k) {
					fieldSchema.adminIndex.push({
						property: k,
						visible: true
					});
					fieldSchema.adminCreate.push({
						property: k,
						visible: true
					});
					fieldSchema.adminRead.push({
						property: k,
						visible: true
					});
					fieldSchema.adminUpdate.push({
						property: k,
						visible: true
					});
					fieldSchema.publicIndex.push({
						property: k,
						visible: true
					});
					fieldSchema.publicCreate.push({
						property: k,
						visible: true
					});
					fieldSchema.publicRead.push({
						property: k,
						visible: true
					});
					fieldSchema.publicUpdate.push({
						property: k,
						visible: true
					});
				}
			);
		} else {
			//console.log(keysSorted);

			//TODO need to keep original sort
			function addKeys(origin, keysSorted) {
				let order = [];

				keysSorted = _.clone(keysSorted);

				//add existing if they still exist
				fields[origin].forEach(
					function (item) {
						//console.log("checking " + item.property)
						let index = _.indexOf(keysSorted, item.property);
						if (index !== -1) {
							//console.log("Adding existing field key =>" + item.property);
							fieldSchema[origin].push(item);
							keysSorted.splice(index, 1);
						}
					}
				);
				keysSorted.forEach(
					function (key) {
						//console.log("Adding new field key =>" + key);
						fieldSchema[origin].push(
							{
								property: key,
								visible: true
							}
						)
					}
				);
			}

			addKeys("adminIndex", keysSorted);
			addKeys("adminCreate", keysSorted);
			addKeys("adminRead", keysSorted);
			addKeys("adminUpdate", keysSorted);
			addKeys("publicIndex", keysSorted);
			addKeys("publicCreate", keysSorted);
			addKeys("publicRead", keysSorted);
			addKeys("publicUpdate", keysSorted);
		}

		if (destination !== "file") {
			await fieldModel.set(tableName, fieldSchema);
		}

		//schemas are always written because the DB can change
		fs.writeFileSync(schemaName + ".js", "module.exports=" +
			stt(stringify(item, {
				indent: '  ',
				singleQuotes: false
			}), 4) + ";");


		if (options.overwrite || !fs.existsSync(fieldPath)) {
			let s = 'module.exports = {\n';
			s += "\tadminIndex : " + JSON.stringify(fieldSchema.adminIndex).split('"property"').join("property").split('"visible"').join("visible") + ",\n";
			s += "\tadminCreate : " + JSON.stringify(fieldSchema.adminCreate).split('"property"').join("property").split('"visible"').join("visible") + ",\n";
			s += "\tadminRead : " + JSON.stringify(fieldSchema.adminRead).split('"property"').join("property").split('"visible"').join("visible") + ",\n";
			s += "\tadminUpdate : " + JSON.stringify(fieldSchema.adminCreate).split('"property"').join("property").split('"visible"').join("visible") + ",\n";
			s += "\tpublicIndex : " + JSON.stringify(fieldSchema.publicIndex).split('"property"').join("property").split('"visible"').join("visible") + ",\n";
			s += "\tpublicCreate : " + JSON.stringify(fieldSchema.publicCreate).split('"property"').join("property").split('"visible"').join("visible") + ",\n";
			s += "\tpublicRead : " + JSON.stringify(fieldSchema.publicRead).split('"property"').join("property").split('"visible"').join("visible") + ",\n";
			s += "\tpublicUpdate : " + JSON.stringify(fieldSchema.publicCreate).split('"property"').join("property").split('"visible"').join("visible") + "\n";
			s += "}";
			fs.writeFileSync(fieldPath, s);
		}

		if (options.overwrite || !fs.existsSync(modelPath)) {

			let modelName = inflector.classify(name);
			let template = fs.readFileSync(templatePath + "/model.js","UTF8");
			template = template.split("ModelName").join(modelName).split("TableName").join(tableName);
			fs.writeFileSync(modelPath, template);

			/*

			let s = "const ModelBase = require('../core/model/ModelBase');\n" +
				"const _ = require('lodash');\n" +
				//"const schema = require('../schema/" + inflector.dasherize(name).toLowerCase() + "-schema');\n" +
				//"const validation = require('../schema/validation/" + inflector.dasherize(name).toLowerCase() + "-validation');\n" +
				//"const fields = require('../schema/fields/" + inflector.dasherize(name).toLowerCase() + "-fields');\n\n" +
				"module.exports = class " + ClassName + " extends ModelBase {\n\n" +
				"\tconstructor(req) {\n" +
				"\t\tsuper(req);\n" +
				"\t}\n\n" +
				"\tget tableName() { return "+ClassName+".tableName; }\n\n" +
				"\tstatic get tableName() { return '"+name+"'; }\n\n" +
				"\tstatic get schema() { return ModelBase.getSchema(" + ClassName + ".tableName); }\n\n" +
				"\tstatic get fields() { return ModelBase.getFields(" + ClassName + ".tableName); }\n\n" +
				"\tasync index(key, value){\n\t\treturn await super.index(key, value);\n\t}\n\n" +
				"\tasync create(data){\n\t\treturn await super.create(data);\n\t}\n\n" +
				"\tasync read(id, query){\n\t\treturn await super.read(id, query);\n\t}\n\n" +
				"\tasync update(id, data, query){\n\t\treturn await super.update(id, data, query);\n\t}\n\n" +
				"\tasync query(query){\n\t\treturn await super.query(query);\n\t}\n\n" +
				"\tasync destroy(id){\n\t\treturn await super.destroy(id);\n\t}\n\n" +
				"\tget relations(){\n\t\treturn {};\n\t}\n\n" +
				"\tget foreignKeys(){\n\t\treturn {};\n\t}\n\n" +
				"}";

			//console.log(s);
			//throw new Error("Stop!!!!!!!!!!!!!!!");
			//return;


			fs.writeFileSync(modelPath, s);
			 */

		}

		if (options.overwrite || !fs.existsSync(controllerPath)) {

			let modelName = inflector.classify(name);
			let template = fs.readFileSync(templatePath + "/controller.js","UTF8");
			template = template.split("ModelName").join(modelName).split("ControllerName").join(modelName);
			fs.writeFileSync(template, s);

			/*
			let s = "const ControllerBase = require('../core/controller/ControllerBase');\n" +
				"const _ = require('lodash');\n" +
				"const Model = require('../model/" + inflector.classify(name) + "Model');\n\n" +
				"module.exports = class " + inflector.classify(name) + "Controller extends ControllerBase {\n\n" +
				"\tconstructor() {\n" +
				"\t\tsuper(Model);\n" +
				"\t}\n\n" +
				"\tasync index(req, res){\n\t\treturn await super.index(req, res);\n\t}\n\n" +
				"\tasync create(req, res){\n\t\treturn await super.create(req, res);\n\t}\n\n" +
				"\tasync read(req, res){\n\t\treturn await super.read(req, res);\n\t}\n\n" +
				"\tasync update(req, res){\n\t\treturn await super.update(req, res);\n\t}\n\n" +
				"\tasync query(req, res){\n\t\treturn await super.query(req, res);\n\t}\n\n" +
				"\tasync search(req, res){\n\t\treturn await super.search(req, res);\n\t}\n\n" +
				"\tasync destroy(req, res){\n\t\treturn await super.destroy(req, res);\n\t}\n\n" +
				"}";

			fs.writeFileSync(controllerPath, s);

			 */
		}

		if (options.overwrite || !fs.existsSync(routerPath)) {

			let modelName = inflector.classify(name);
			let endpoint = inflector.dasherize(inflector.singularize(name), false)
			let template = fs.readFileSync(templatePath + "/route.js","UTF8");
			template = template.split("ControllerName").join(modelName).split("EndPointName").join(endpoint);
			fs.writeFileSync(routerPath, template);

			/*
			let s = "let router = require('express').Router();\n" +
				"let authentication = require('../core/middleware/authentication');\n" +
				"const Controller = require('../controller/" + inflector.classify(name) + "Controller');\n" +
				"let c = new Controller()\n\n" +
				"router.use(authentication);\n\n" +
				"router.use(async function(req, res, next){\n\treq.allowRole('api-user');\n\t//add other roles as needed, or call req.addRole('some-role') in individual endpoints \n\treturn next();\n});\n\n" +
				"router.get('/index', async function (req, res, next) {\n" +
				"\tif(req.checkRole()){\n" +
				"\t\treturn await c.index(req, res);\n\t}\n\treturn next();\n" +
				"});\n\n" +
				"router.get('/search', async function (req, res, next) {\n" +
				"\tif(req.checkRole()){\n" +
				"\t\treturn await c.search(req, res);\n\t}\n\treturn next();\n" +
				"});\n\n" +
				"router.get('/', async function (req, res, next) {\n" +
				"\tif(req.checkRole()){\n" +
				"\t\treturn await c.query(req, res);\n\t}\n\treturn next();\n" +
				"});\n\n" +
				"router.get('/:id', async function (req, res, next) {\n" +
				"\tif(req.checkRole()){\n" +
				"\t\treturn await c.read(req, res);\n\t}\n\treturn next();\n" +
				"});\n\n" +
				"router.post('/', async function (req, res, next) {\n" +
				"\tif(req.checkRole()){\n" +
				"\t\treturn await c.create(req, res);\n\t}\n\treturn next();\n" +
				"});\n\n" +
				"router.put('/:id', async function (req, res, next) {\n" +
				"\tif(req.checkRole()){\n" +
				"\t\treturn await c.update(req, res);\n\t}\n\treturn next();\n" +
				"});\n\n" +
				"router.patch('/:id', async function (req, res, next) {\n" +
				"\tif(req.checkRole()){\n" +
				"\t\treturn await c.update(req, res);\n\t}\n\treturn next();\n" +
				"});\n\n" +
				"router.delete('/:id', async function (req, res, next) {\n" +
				"\tif(req.checkRole()){\n" +
				"\t\treturn await c.destroy(req, res);\n\t}\n\treturn next();\n" +
				"});\n\n" +
				"module.exports = router;"

			fs.writeFileSync(routerPath, s);
			*/
		}

		routers.push(name);
		//}
		//);
	}

	if (destination === "memory") {
		return;
	}

	routers.sort();

	routers = _.uniq(routers);

	let s = "let router = require('express').Router();\n";
	routers.forEach(
		function (item) {
			s += "const " + inflector.camelize(item, false) + "Router = require('./" + inflector.dasherize(item).toLowerCase() + "-router');\n"
		}
	);

	s += "\n";

	routers.forEach(
		function (item) {
			let ep = inflector.dasherize(inflector.singularize(item), false);
			ep = ep.split("metum").join("meta");
			s += "router.use('/" + ep + "', " + inflector.camelize(item, false) + "Router);\n"
		}
	);

	s += "\n\nmodule.exports = router;\n";

	fs.writeFileSync("./src/router/app-router.js", s);

	console.log("done");
	process.exit();
}

module.exports = convert;