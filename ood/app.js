const express = require('express');
const app = express();
const port = 3000;

// have to use a Router to mount the `PASSENGER_BASE_URI`
// base uri that's /pun/dev/appname or /pun/sys/appname depending
// on the environment.
const router = express.Router();
app.use(process.env.PASSENGER_BASE_URI || '/', router);

router.get('/', (req, res) => {
  res.send('Hello World!');
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
})