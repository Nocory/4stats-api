const config = require("./config")

const pino = require("pino")({
	name: 'api',
	safe: true,
	//prettyPrint: process.env.NODE_ENV != "production",
	prettyPrint: true,
	level: process.env.PINO_LEVEL || (process.env.NODE_ENV == "production" ? config.debugLevelProduction : config.debugLevelDevelopment),
	base: null
})

module.exports = pino