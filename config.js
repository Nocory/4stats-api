const config = {
	enforcedClientVersion: 19,
	debugLevelDevelopment: "trace", // ["fatal","error","warn","info","debug","trace"]
	debugLevelProduction: "info",	
	popularThreads: 8,
	gathererURL: process.env.GATHERER_URL || "http://localhost:4002"
}

module.exports = config