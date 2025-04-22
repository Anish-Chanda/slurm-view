const express = require('express');
const { getSlurmJobs } = require('./handlers/fetchJobs.js');
const { engine } = require('express-handlebars');
const { getCPUsByState, getMemByState } = require('./handlers/fetchStats.js');


const app = express();
const port = 3000;

//handlebars config
app.engine('handlebars', engine());
app.set('view engine', 'handlebars');
app.set('views', './views');

const router = express.Router();
app.use(process.env.PASSENGER_BASE_URI || '/', router);

router.get('/api/jobs', async (req, res) => {
  const result = getSlurmJobs(req.query);
  res.json(result)
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
  const jobs = getSlurmJobs(req.query);
  // TODO: use promise all instead
  const cpuStats = getCPUsByState();
  const memStats = getMemByState();
  res.render('home', {
    title: "Slurm View",
    hasError: !jobs.success,
    errorMessage: jobs.error,
    jobs: jobs.success ? jobs.jobs : [],
    cpuStats,
    memStats,
    passengerBaseUri: process.env.PASSENGER_BASE_URI
  })
});

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});