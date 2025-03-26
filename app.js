import express from 'express';
import { getSlurmJobs } from './handlers/fetchJobs.js';
import { engine } from 'express-handlebars';


const app = express();
const port = 3000;

//handlebars config
app.engine('handlebars', engine());
app.set('view engine', 'handlebars');
app.set('views', './views');

const router = express.Router();
app.use(process.env.PASSENGER_BASE_URI || '/', router);

router.get('/api/jobs', async (req, res) => {
  const jobsTable = await getSlurmJobs();
  res.send(jobsTable);
});

router.get('/', async (req, res) => {
  const jobsTable = await getSlurmJobs();
  res.render('home', {
    title: "Slurm View",
    jobsTable: jobsTable
  })
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
