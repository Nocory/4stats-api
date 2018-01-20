# 4stats-API

The ***4stats-API*** serves as a middleman between the ***Gatherer*** and the ***Client***.

The ***API*** continuously receives updates from the ***Gatherer***, which it then forwards to any connected ***Clients***, that have established a socket connection.

It also offers endpoints for board-stats, active-threads and board-history requests.

---
## API
### Base-URL: https://api.4stats.io

---
```
/allBoardStats
```

Query parameters: ***None***

Returns an object with the live statistics of all boards.

---
```
/boardStats

Examples:
/boardStats?board=vg
/boardStats?boards=a,mu,trv
```

Query parameters:

`board` ***if used*** must be exactly 1 board. Will return an object with live board-stats.

`boards` ***if used*** should be a comma separated list of boards. Will return an object of objects containing live board-stats.

---
```
/history

Examples:
/history?term=hour&board=trv
/history?term=day&boards=a,pol,v
```

Query parameters:

`term` ***Must be*** *day* or *hour*.

`board` ***if used*** should be exactly 1 board. Will return an array of history entries.

`boards` ***if used*** should be a comma separated list of boards. Will return an object of arrays of history entries.

History arrays are:
```
[unix-timestamp,
ms of duration covered,
posts during duration,
posts/min during duration]
```

Day entries always start at 9:00AM UTC and cover the following 24 hours.

Hour entries are placed at each full hour, covering the preceeding and following 30 minutes.

(An entry for 08:00 would cover the time from 07:30 - 08:30)

---
### CORS
Enabled for https://4stats.io and http://localhost

---
### Rate limit
The API limits clients to 2 requests per second.

There is a burst allowance of 20 requests per IP though.