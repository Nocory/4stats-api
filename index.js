const config = require('./config')
const pino = require('./pino')
//const axios = require('axios')

pino.info("process.env.NODE_ENV is %s",process.env.NODE_ENV)
pino.info("process.env.DEBUG is %s",process.env.DEBUG)
pino.info("process.env.PINO_LEVEL is %s",process.env.PINO_LEVEL)
pino.info("config.gathererURL is %s",config.gathererURL)

let boardStats = {}
let activeThreads = {}
let history = {
	hour : {},
	day : {}
}

////////////////////
// Gatherer setup //
////////////////////
const gathererIO = require('socket.io-client')(config.gathererURL,{
	transports: ['websocket']
})

///////////////
// API setup //
///////////////
const app = require('express')()
const server = require('http').createServer(app)

const corsOptions = {
	origin: [
		"http://localhost:3000",
		"https://4stats.io",
		"https://4stats.moe",
		"https://dev.4stats.io",
		"null"],
}

app.set('trust proxy', 'loopback')
app.use(require("cors")(corsOptions))
app.use(require('helmet')())
app.use(require('compression')()) // TODO: not needed? Maybe nginx handles it by itself

const apiIO = require('socket.io')(server)
apiIO.origins(["localhost:*","4stats.io:*","4stats.moe:*","dev.4stats.io:*"])

app.use(function (req, res, next) {
	pino.info("%s %s %s",req.ip.padEnd(15," "),req.method,req.originalUrl)
	next()
})

server.listen(4001)

/////////////////////////
// Gatherer connection //
/////////////////////////
gathererIO.on("connect", () => {
	pino.info("✓✓✓ gathererIO connected to %s",config.gathererURL)
})

gathererIO.on("disconnect", reason => {
	pino.error("gathererIO disconnected from %s - %s",config.gathererURL,reason)
})

gathererIO.on("initialData", initialData => {
	pino.info("✓✓✓ gathererIO received initialData")
	boardStats = initialData.liveBoardStats
	activeThreads = initialData.activeThreads
	history = initialData.history
	apiIO.emit("allBoardStats",boardStats)
})

gathererIO.on("update", update => {
	pino.debug("gathererIO received update for /%s/ history -> %j",update.board,Object.keys(update.history))
	boardStats[update.board] = update.newBoardStats
	activeThreads[update.board] = update.newActiveThreads
	for(let term in update.history) history[term][update.board] = update.history[term]
	apiIO.emit("boardUpdate",update.board,update.newBoardStats)
})

////////////////////
// API connection //
////////////////////
let timerRunning = false
const sendUserCount = () => {
	if(timerRunning) return
	timerRunning = true
	//pino.info("userCount timer START")
	setTimeout(() => {
		apiIO.emit("userCount",apiIO.engine.clientsCount)
		timerRunning = false
		pino.info("Sending userCount: %d",apiIO.engine.clientsCount)
	},2000)
}
/*
setInterval(() => {
	apiIO.emit("userCount",apiIO.engine.clientsCount)
},5316)
*/
apiIO.on('connection', socket => {
	sendUserCount()
	let ip = socket.request.headers["x-real-ip"] || socket.request.headers["x-forwarded-for"] || socket.handshake.address
	pino.info("%s Connected %s",ip.padEnd(15," "),socket.handshake.query.connectionType)
	socket.emit("enforcedClientVersion",config.enforcedClientVersion)
	socket.emit("allBoardStats",boardStats)

	socket.on("disconnect",reason => {
		sendUserCount()
		reason = reason == "client namespace disconnect" ? "tab hidden" : reason
		pino.info("%s Disc. %s",ip.padEnd(15," "),reason)
	})
	/*
	setTimeout(() => {
		socket.emit("userCount",apiIO.engine.clientsCount)
	},250)
	*/
})

app.get('/', function (req, res) {
	res.redirect('https://github.com/Nocory/4stats-api#4stats-api')
})

app.get('/all', function (req, res) {
	res.send(boardStats)
})

app.get('/allBoardStats', function (req, res) {
	res.send(boardStats)
})

app.get('/board/:board', function (req, res) {
	res.send(boardStats[req.params.board])
})

app.get('/boards/:boards', function (req, res) {
	const boardsArr = req.params.boards.split(",")
	if(boardsArr.length > 10) return res.status(403).send('Query must not contain more than 10 boards')
	let result = {}
	for(let board of boardsArr){
		result[board] = boardStats[board]
	}
	res.send(result)
})

app.get('/activeThreads/:board', function (req, res) {
	res.send(activeThreads[req.params.board])
})

app.get('/history/:term/:board', (req, res) => {
	if(history[req.params.term]){
		res.send(history[req.params.term][req.params.board])
	}else{
		res.status(403).send('Invalid Query')
	}
})