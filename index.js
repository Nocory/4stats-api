const config = require('./config')
const pino = require('./pino')
//const axios = require('axios')

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

let combinedHistoryObj = {
	day: {},
	hour: {}
}

let combinedHistory = {
	day: [],
	hour: []
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
		combinedHistory[term].push([entry[0],entry[1],combinedEntry.postsInTerm,combinedEntry.postsPerMinute])
	}
}

/////////////////////////
// Gatherer connection //
/////////////////////////
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
	}

	for(let term of ["day","hour","cycle"]){
		for(let board in initialData.history[term]){
			initialData.history[term][board] = fillGaps(term,initialData.history[term][board])

			console.log("supDB has",board,supDB.has(board).value())
			if(term == "day" && supDB.has(board).value()){
				console.log(board,"length",supDB.get(board).value().length)
				initialData.history[term][board] = [...supDB.get(board).value(),...initialData.history[term][board]]
			}

			adjustHistoryOfNoDubBoards(board,initialData.history[term][board])
		}
	}
	
	boardStats = initialData.liveBoardStats
	activeThreads = initialData.activeThreads
	history = initialData.history

	/*
	for(let term of ["day","hour"]){
		for(let board in history[term]){
			for(let entry of history[term][board]){
				calcCombinedHistory(term,entry)
			}
			pino.info("fin comb. %s %s",term,board)
		}
	}
	*/
	
	apiIO.emit("allBoardStats",boardStats)
})

gathererIO.on("update", update => {
	pino.debug("gathererIO received update for /%s/ history -> %j",update.board,Object.keys(update.history))

	adjustDataOfNoDubBoards(update.board,update.newBoardStats)

	boardStats[update.board] = update.newBoardStats
	if (update.newActiveThreads) activeThreads[update.board] = update.newActiveThreads
	for(let term in update.history){
		update.history[term] = fillGaps(term,update.history[term])

		console.log("supDB has",update.board,supDB.has(update.board).value())
		if(term == "day" && supDB.has(update.board).value()){
			console.log(update.board,"length",supDB.get(update.board).value().length)
			update.history[term] = [...supDB.get(update.board).value(),...update.history[term]]
		}

		adjustHistoryOfNoDubBoards(update.board,update.history[term])

		history[term][update.board] = update.history[term]
		//calcCombinedHistory(term,update.history[term])
	}
	apiIO.emit("boardUpdate",update.board,update.newBoardStats)
})

gathererIO.on("gathererError", err => {
	apiIO.emit("serverError","Gatherer: " + err)
})

gathererIO.on('error', error => {
  apiIO.emit("serverError","API: " + error.message || error.data || error)
});

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

app.get('/combinedHistory/:term', (req, res) => {
	res.send(combinedHistory[req.params.term])
})

//////////////
// Info Box //
//////////////

const crypto = require('crypto');
const validPW = "ddfbc49d225314681f1f2e872110960759df78d0646309918352563ca26d40fc"
let infoString = ""

apiIO.on("updateInfoText",(text,pw) => {
	const digest = crypto.createHash('sha256').update(pw).digest('hex');
	infoString = text
})

///////////////////////
// snapshot analysis //
///////////////////////

//const snapperAddr = "http://10.9.96.5:8080"
const snapperAddr = "http://163.172.158.243:8080"

const snapperIO = require('socket.io-client')(snapperAddr,{
	transports: ['websocket']
})

let textAnalysis = {}
let metaAnalysis = {}

snapperIO.on("connect", () => {
	pino.info("✓✓✓ snapperIO connected to %s",snapperAddr)
})

snapperIO.on("disconnect", reason => {
	pino.error("snapperIO disconnected from %s - %s",snapperAddr,reason)
})

snapperIO.on("initialData", initialData => {
	pino.info("✓✓✓ snapperIO received initialData")
	for(let board of Object.keys(initialData).sort()){
		//textAnalysis[board] = initialData[board].textAnalysis
		metaAnalysis[board] = initialData[board].metaAnalysis
	}
})

snapperIO.on("update", update => {
	pino.debug("snapperIO received update")
	//textAnalysis[update.board] = update.textAnalysis
	metaAnalysis[update.board] = update.metaAnalysis
})

const axios = require('axios')
app.get('/textAnalysis', async (req, res) => {
	const word = req.query.word
	if(!word || word.length < 3 || word.length > 20){
		res.status(400).send("word is too short or too long (3-20 characters)")
		return
	}
	try{
		const result = await axios.get(`${snapperAddr}/analyzeText?word=${word}`)
		res.send(result.data)
	}catch(err){
		res.status(500).send("sorry the server fucked up")
		console.error(err.message)
	}
	return
})
/*
app.get('/textAnalysisLastDay/:word', async (req, res) => {
	try{
		res.send(textAnalysis[req.params.word])
	}catch(err){
		conole.error(err.message)
	}
	return
})
*/
app.get('/metaAnalysis', (req, res) => {
	res.send(metaAnalysis)
})

app.get('/metaAnalysis/:board', (req, res) => {
	res.send(metaAnalysis[req.params.board])
})

let csvStrings = {}

snapperIO.on("csvStrings", strings => {
	pino.debug("snapperIO received csvStrings")
	csvStrings = strings
})

app.get('/csv/:name', function (req, res) {
	res.set('Content-Type', 'text/csv')
	res.set('Content-Disposition', `attachment; filename=${req.params.name}.csv`)
	if(!csvStrings[req.params.name]){
		res.sendStatus(404)
	}else{
		res.send(csvStrings[req.params.name])
	}
})
/*
app.get('/wordAnalysis/:word', async (req, res) => {
	try{
		res.send(await axios.get(snapperAddr + `/wordAnalysis/${req.params.name}`).data)
	}catch(err){
		pino.error(err.message)
	}
})
*/