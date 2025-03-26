import express from 'express';
import { getSlurmJobs } from './handlers/fetchJobs.js';

const app = express();
const port = 3000;

const router = express.Router();
app.use(process.env.PASSENGER_BASE_URI || '/', router);

router.get('/api/jobs', async (req, res) => {
  const jobsTable = await getSlurmJobs();
  res.send(jobsTable);
});

router.get('/', async (req, res) => {
  const jobsTable = await getSlurmJobs();
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Slurm Jobs</title>
      <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
    </head>
    <body class="font-sans m-5 p-5 bg-gray-100">
      <h1 class="text-center text-gray-800 mb-6 text-2xl">Slurm Job Queue</h1>
      
      <!-- Jobs Table Container -->
      <div id="jobs-table">
        ${jobsTable}
      </div>
    </body>
    </html>
  `);
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
