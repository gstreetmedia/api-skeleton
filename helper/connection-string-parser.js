/**
 *
 * @param value
 * @returns {{password: string, protocol: (*|string), port: string, host: string, db: string, username: string}}
 */
module.exports = function (value) {

	//mssql://WCTY:HG@R!835$@72.26.113.116:4308/WCTY_RAPDATA?encrypt=true&connectionTimeout=86400000
	try {

		let parts = value.split("://");
		let protocol = parts[0];
		let credentials = parts[1].substr(0, parts[1].lastIndexOf("@"));

		let username = credentials.split(":")[0];
		let password = credentials.split(":")[1];

		parts = parts[1].split("@");
		parts = parts[parts.length - 1];

		let dbPath = parts.split("/")[0];
		let hostParts = dbPath.split(":");

		let host = hostParts[0];
		let port = hostParts.length > 1 ? hostParts[1] : "";
		if (port) {
			port = parseInt(port);
		}
		let tail = parts.split("/")[1].split("?");

		let dbName = tail[0];

		let obj = {
			username: username,
			password: password,
			protocol: protocol,
			host: host,
			port: port,
			database: dbName,
		};

		if (tail.length > 1) {
			let values = tail[1].split("&");
			let fields = [];
			values.forEach(
				function (item) {
					let key = item.split("=")[0];
					let value = item.split("=")[1];
					fields[key] = value;
				}
			);
			obj.fields = fields;
		}

		return obj;
	} catch (e) {
		console.error("Connection String Could not parse " + value)
	}
};