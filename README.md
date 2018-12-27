# 4stats-API

The ***4stats-API*** serves as a middleman between the ***Gatherer*** and the ***Client***.

The ***API*** continuously receives updates from the ***Gatherer***, which it then forwards to any connected ***Clients***, that have established a socket connection.

It also offers endpoints for board-stats, active-threads and board-history requests.

---
## API
### Base-URL: https://api.4stats.io

---
### /allBoardStats
>Example: https://api.4stats.io/allBoardStats

Returns an object with the live statistics of all boards.

---
### /board/:board
>Example: https://api.4stats.io/board/g

`:board` must be a single valid board.

Returns an object of live board statistics.

---
### /boards/:boards
>Example: https://api.4stats.io/boards/g,x,pol,trv

`:boards` must be a comma separated list.

Returns an object of objects of live board statistics.

---
### /activeThreads/:board
>Example https://api.4stats.io/activeThreads/a

`:board` must be a single valid board.

Returns an array of objects, containing the currently most active threads, sorted by their posts/minute.

---
### /history/:term/:board
>Example: https://api.4stats.io/history/day/biz

`:term` must be *day*, *hour* or *cycle*.

`:board` must be a single valid board.

*day* and *hour* return an array of arrays in the format:
```
[unix-timestamp,
milliseconds of duration covered,
posts during duration,
posts/min during duration]
```

*cycle* returns an array of arrays in the format:
```
[unix-timestamp,
milliseconds of duration covered,
posts during duration,
threads during duration,
newest post number,
newest thread number]
```

`day` returns the complete history. `hour` returns the last 4 weeks. `cycle` returns the last 3 days.

Day entries always start at 9:00AM UTC and cover the following 24 hours.

Hour entries are placed at each full hour, covering the preceeding and following 30 minutes.

(An entry for 08:00 would cover the time from 07:30 - 08:30)

Cycle entries are ~5 minutes apart.

---
### CORS
Enabled for
* https://4stats.io
* http://localhost:3000
* null (local files)

---
### Rate limit
The API limits clients to 2 requests per second.

There is a burst allowance of 20 requests per IP though.