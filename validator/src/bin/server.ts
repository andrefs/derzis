
const graphFolder = process.argv[2];
import express, { Request, Response, NextFunction } from 'express';

const app = express();

const now = () => new Date().toISOString();

// Request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${now()} - ${req.method} ${req.originalUrl} - Host: ${req.hostname} - IP: ${req.ip}`);
  next();
});


app.get('/', (req: Request, res: Response) => {
  res.send('Up and running');
});

app.get('/sw/:type-:num', (req: Request, res: Response) => {
  const { type, num } = req.params;
  console.log(`${now()} - Request for /sw/${type}-${num} in domain ${req.hostname}`);
})

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Server is running on http://localhost:' + port);
})
