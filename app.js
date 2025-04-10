const express = require('express');
const { getSlurmJobs } = require('./handlers/fetchJobs.js');
const { engine } = require('express-handlebars');
const { getCPUsByState } = require('./handlers/fetchStats.js');


const app = express();
const port = 3000;

//handlebars config
app.engine('handlebars', engine());
app.set('view engine', 'handlebars');
app.set('views', './views');

const router = express.Router();
app.use(process.env.PASSENGER_BASE_URI || '/', router);

router.get('/api/jobs', async (req, res) => {
  const jobsTable = getSlurmJobs(req.query);
  res.send(jobsTable);
});

// router.get('/api/stats/cpu-s', (req, res) => {
//   try {
//     const stats = getCPUsByState();
//     res.json(stats);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

router.get('/', async (req, res) => {
  const jobsTable = getSlurmJobs(req.query);
  const cpuStats = getCPUsByState();
  res.render('home', {
    title: "Slurm View",
    jobsTable,
    cpuStats,
    passengerBaseUri: process.env.PASSENGER_BASE_URI
  })
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});