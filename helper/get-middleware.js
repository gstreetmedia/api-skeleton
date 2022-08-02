let fs = require("fs");
let path = require("path");
const checkRequire = require("./check-require");
/**
 * @param {string} middleware
 * @returns {function}
 */
module.exports = (middleware) => {

	let paths = [
		path.resolve(global.appRoot + '/src/middleware/' + middleware + ".js"),
		path.resolve(__dirname + '/../middleware/' + middleware + ".js"),
	];

	while(paths.length > 0) {
		let o = checkRequire(paths[0]);
		if (o) {
			return o;
		}
		paths.shift();
	}

	return null;
}