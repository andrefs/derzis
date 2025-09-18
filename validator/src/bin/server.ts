
const graphFolder = process.argv[2];
import express, { Request, Response } from 'express';

const app = express();


app.get('/', (req: Request, res: Response) => {
  res.send('Up and running');
});

app.get('/sw/:type-:num', (req: Request, res: Response) => {
  const { type, num } = req.params;
  console.log(`Request for /sw/${type}-${num} in domain ${req.hostname}`);
})

const port = process.env.VALIDATOR_PORT || 3000;
app.listen(port, () => {
  console.log('Server is running on http://localhost:' + port);
})
