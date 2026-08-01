import express from 'express';
import { chatHandler } from './routes/chat';

const app = express();

app.use(express.json());

app.post('/api/chat', chatHandler);

const port = Number(process.env.PORT || 8080);

app.listen(port, () => {
  console.log(`pi-wren api listening on ${port}`);
});
