const config = require('./config')
const pino = require('./pino')
const axios = require('axios')

const gathererURL = "http://localhost:4002"

let boardStats = {}
let activeThreads = {}
let history = {
	hour : {},
	day : {}
}

// Gatherer connection

const gathererIO = require('socket.io-client')(gathererURL,{
	transports: ['websocket']
})

gathererIO.on("connect", socket => {
	pino.info("gathererIO connected to gatherer server %s",gathererURL)
})

gathererIO.on("disconnect", socket => {
	pino.error("gathererIO disconnected from gatherer server %s",gathererURL)
})

gathererIO.on("update", update => {
	pino.debug("gathererIO received update for /%s/ history -> %j",update.board,Object.keys(update.history))
	boardStats[update.board] = update.newBoardStats
	activeThreads[update.board] = update.newActiveThreads
	for(let term in update.history) history[term][update.board] = update.history[term]
	serverIo.emit("boardUpdate",update.board,update.newBoardStats)
})

gathererIO.on("initialData", initialData => {
	pino.info("gathererIO received initialData")
	boardStats = initialData.liveBoardStats
	activeThreads = initialData.activeThreads
	history = initialData.history
})


// Client connection

const app = require('express')()
const server = require('http').Server(app)
const serverIo = require('socket.io')(server)
const cors = require("cors")

app.use(cors())
app.use(require('helmet')())
app.use(require('compression')()) // TODO: not needed? Maybe nginx handles it by itself

server.listen(4001)

serverIo.on('connection', socket => {
	let ip = socket.request.headers["x-real-ip"] || socket.request.headers["x-forwarded-for"] || socket.handshake.address
	pino.debug("New connection from %s",ip)
	socket.emit("enforcedClientVersion",config.enforcedClientVersion)
})

app.get('/allBoardStats', function (req, res) {
	pino.debug("expressApp.get /allBoardStats ip: %s",req.get('x-real-ip') || req.ip)
	res.send(boardStats)
})

app.get('/boardStats', function (req, res) {
	pino.debug("expressApp.get /boardStats ip: %s query: %j",req.get('x-real-ip') || req.ip,req.query)
	if(req.query.board && req.query.board.includes(",")){
		let resultObj = {}
		let boardQueries = req.query.board.split(",")
		for(let board of boardQueries){
			resultObj[board] = boardStats[board]
		}
		res.send(resultObj)
	}else{
		res.send(boardStats[req.query.board] || null)
	}
})

app.get('/activeThreads', function (req, res) {
	pino.debug("expressApp.get /activeThreads ip: %s query: %s",req.get('x-real-ip') || req.ip,req.query.board)
	res.send(activeThreads[req.query.board] || [])
})

app.get('/history', (req, res) => {
	const board = req.query.board
	const term = req.query.term
	pino.debug("expressApp.get /timeline ip: %s query: %j",req.get('x-real-ip') || req.ip,{board,term})
	if(history[term]){
		res.send(history[term][board] || [])
	}else{
		res.send([])
	}
})