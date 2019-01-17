const config = require('./config')
const pino = require('./pino')

const low = require('lowdb')
const FileSync = require('lowdb/adapters/FileSync')
const supDB = low(new FileSync('supplementalDays.json'))

pino.info("process.env.NODE_ENV is %s",process.env.NODE_ENV)
pino.info("process.env.DEBUG is %s",process.env.DEBUG)
pino.info("process.env.PINO_LEVEL is %s",process.env.PINO_LEVEL)
pino.info("config.gathererURL is %s",config.gathererURL)

let boardStats = {}
let activeThreads = {}
let history = {
	hour : {},
	day : {},
	cycle: {}
}
let postAnalysisResult = {}

///////////////////
// Express setup //
///////////////////
const app = require('express')()
const server = require('http').createServer(app)

const corsOptions = {
	origin: [
		"http://localhost:3000",
		"http://localhost:1234",
		"https://4stats.io",
		"https://4stats.moe",
		"https://dev.4stats.io",
		"https://nuxt.4stats.io",
		"null"],
}

app.set('trust proxy', 'loopback')
app.use(require("cors")(corsOptions))
app.use(require('helmet')())
app.use(require('compression')()) // TODO: not needed? Maybe nginx handles it by itself

const apiIO = require('socket.io')(server)
apiIO.origins([
	"localhost:*",
	"4stats.io:*",
	"4stats.moe:*",
	"dev.4stats.io:*",
	"nuxt.4stats.io:*"
])

app.use(function (req, res, next) {
	pino.info("%s %s %s",req.ip.padEnd(15," "),req.method,req.originalUrl)
	next()
})

server.listen(4001)

////////////////////////////
// Combined Board History //
////////////////////////////
let combinedHistoryObj = {
	day: {},
	hour: {}
}

const calcCombinedHistory = (term,entry) => {
	if(!combinedHistoryObj[term][entry[0]]) combinedHistoryObj[term][entry[0]] = {
		postsInTerm: 0,
		postsPerMinute: 0,
		boardsConsidered: 0
	}

	const combinedEntry = combinedHistoryObj[term][entry[0]]

	combinedEntry.postsInTerm += entry[2]
	combinedEntry.postsPerMinute += entry[3]
	combinedEntry.boardsConsidered += 1

	if(combinedEntry.boardsConsidered == 72){
		history[term].all.push([entry[0],entry[1],combinedEntry.postsInTerm,combinedEntry.postsPerMinute])
		if(term == "hour"){
			history[term].all.slice(-24 * 7 * 4) //TODO: could do .shift() instead and remove up to certain time
		}
	}
}

//////////////////////////
// Processing Functions //
//////////////////////////
const adjustDataOfNoDubBoards = (board,data)=>{
	if(["v","vg","vr"].includes(board)){
		data.postsPerMinute *= 0.901
		data.avgPostsPerDay *= 0.901
		data.topPPM *= 0.901
	}
	return data
}

const adjustHistoryOfNoDubBoards = (board,data)=>{
	if(["v","vg","vr"].includes(board)){
		for(let entry of data){
			if(!data[2]) continue
			entry[2] *= 0.901
			entry[3] *= 0.901
		}
	}
	return data
}

const fillGaps = (term,data) => {
	if(!data.length) return []
	if(term == "cycle") return data

	const interval = term == "hour" ? 1000 * 60 * 60 : 1000 * 60 * 60 * 24
	const newArr = []

	let expectedTime = data[0][0]

	for(let entry of data){
		while(expectedTime < entry[0]){
			//pino.info(`Added null gap to ${board}`)
			newArr.push([expectedTime,interval,NaN,NaN])
			expectedTime += interval
		}
		newArr.push(entry)
		expectedTime = entry[0] + interval
	}
	return newArr
}

/////////////////////////
// Gatherer connection //
/////////////////////////
const gathererIO = require('socket.io-client')(config.gathererURL,{
	transports: ['websocket']
})

gathererIO.on("connect", () => {
	pino.info("✓✓✓ gathererIO connected to %s",config.gathererURL)
})

gathererIO.on("disconnect", reason => {
	pino.error("gathererIO disconnected from %s - %s",config.gathererURL,reason)
})

gathererIO.on("initialData", initialData => {
	pino.info("✓✓✓ gathererIO received initialData")

	for(let board in initialData.liveBoardStats){
		adjustDataOfNoDubBoards(board,initialData.liveBoardStats[board])
		
		if (initialData.activeThreads[board].length){
			initialData.liveBoardStats[board].hasSticky = initialData.activeThreads[board][0].sticky ? true : false //TODO: move this to the gatherer !!
		}
	}

	for(let term of ["day","hour","cycle"]){
		for(let board in initialData.history[term]){
			initialData.history[term][board] = fillGaps(term,initialData.history[term][board])

			//console.log("supDB has",board,supDB.has(board).value())
			if(term == "day" && supDB.has(board).value()){
				console.log(board,"sup length",supDB.get(board).value().length)
				initialData.history[term][board] = [...supDB.get(board).value(),...initialData.history[term][board]]
			}

			adjustHistoryOfNoDubBoards(board,initialData.history[term][board])
		}
	}
	
	boardStats = initialData.liveBoardStats
	activeThreads = initialData.activeThreads
	history = initialData.history
	history.day.all = []
	history.hour.all = []
	history.cycle.all = []

	const now = Date.now()

	for(let term of ["day","hour"]){
		for(let board in history[term]){
			for(let entry of history[term][board]){
				if(entry[0] < now - 1000 * 60 * 60 * 24 * 365 * 1.5) continue
				calcCombinedHistory(term,entry)
			}
			pino.info("fin comb. %s %s",term,board)
		}
	}
	
	apiIO.emit("allBoardStats",boardStats)
})

gathererIO.on("update", update => {
	pino.debug("gathererIO received update for /%s/ history -> %j",update.board,Object.keys(update.history))

	if (update.newActiveThreads.length){
		update.newBoardStats.hasSticky = update.newActiveThreads[0].sticky ? true : false //TODO: move this to the gatherer !!
		activeThreads[update.board] = update.newActiveThreads
	}

	adjustDataOfNoDubBoards(update.board,update.newBoardStats)
	boardStats[update.board] = update.newBoardStats

	for(let term in update.history){
		update.history[term] = fillGaps(term,update.history[term])

		//console.log("supDB has",update.board,supDB.has(update.board).value())
		if(term == "day" && supDB.has(update.board).value()){
			console.log(update.board,"sup length",supDB.get(update.board).value().length)
			update.history[term] = [...supDB.get(update.board).value(),...update.history[term]]
		}

		adjustHistoryOfNoDubBoards(update.board,update.history[term])

		history[term][update.board] = update.history[term]
		if(term == "day" || term == "hour"){
			calcCombinedHistory(term,update.history[term])
		}
	}
	apiIO.emit("boardUpdate",update.board,update.newBoardStats)
})

gathererIO.on("gathererError", err => {
	apiIO.emit("serverError","Gatherer: " + err)
})

gathererIO.on('error', error => {
  apiIO.emit("serverError","API: " + error.message || error.data || error)
});

//////////////////////////////
// Post Analysis connection //
//////////////////////////////
const paAddr = "http://51.15.57.204:8080"

const paIO = require('socket.io-client')(paAddr,{
	transports: ['websocket']
})

paIO.on("connect", () => {
	pino.info("✓✓✓ paIO connected to %s",paAddr)
})

paIO.on("disconnect", reason => {
	pino.error("paIO disconnected from %s - %s",paAddr,reason)
})

paIO.on("initialData", initialData => {
	pino.info("✓✓✓ paIO received initialData")
	postAnalysisResult = initialData
})

paIO.on("update", (board,stats) => {
	pino.debug("paIO received update")
	postAnalysisResult[board] = stats
})

////////////////////
// API connection //
////////////////////
let nextUserCountEmitTime = 0
let timerRunning = false

const sendUserCount = (minDelay = 0) => {
	if(timerRunning) return
	timerRunning = true
	
	const now = Date.now()
	const delay = Math.max(minDelay,nextUserCountEmitTime - now)
	nextUserCountEmitTime = now + delay + 2000

	setTimeout(() => {
		timerRunning = false
		apiIO.emit("userCount",apiIO.engine.clientsCount)
		pino.info("Sending userCount: %d",apiIO.engine.clientsCount)
	},delay)
}

apiIO.on('connection', socket => {
	let ip = socket.request.headers["x-real-ip"] || socket.request.headers["x-forwarded-for"] || socket.handshake.address
	pino.info("%s Connected %s",ip.padEnd(15," "),socket.handshake.query.connectionType)
	socket.emit("enforcedClientVersion",config.enforcedClientVersion)
	if(!socket.handshake.query.dontSendBoards){
		socket.emit("allBoardStats",boardStats)
	}
	sendUserCount(500)

	socket.on("disconnect",reason => {
		reason = reason == "client namespace disconnect" ? "tab hidden" : reason
		pino.info("%s Disc. %s",ip.padEnd(15," "),reason)
		sendUserCount(2000) // socket.io disconnect events dont update the socket count right away
	})
})

app.get('/', function (req, res) {
	res.redirect('https://github.com/Nocory/4stats-api#4stats-api')
})

app.get('/allBoardStats', function (req, res) {
	res.send(boardStats)
})

app.get('/board/:board', function (req, res) {
	res.send(boardStats[req.params.board])
})

app.get('/boards/:boards', function (req, res) {
	const boardsArr = req.params.boards.split(",")
	if(boardsArr.length > 36) return res.status(403).send('Query must not contain more than 36 boards')
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

app.get('/allPostAnalysis', (req, res) => {
	res.send(postAnalysisResult)
})