
const graphFolder = process.argv[2];
import express, { Request, Response } from 'express';

const app = express();


app.get('/', (req: Request, res: Response) => {
  res.send('Up and running');
});

app.get('/sw/:type-:num', (req: Request, res: Response) => {
  const { type, num } = req.params;
  console.log(`Request for /Sw/${type}-${num} in domain ${req.hostname}`);
})

app.listen(3000, () => {
  console.log('Server is running on http://localhost:3000');
})
