import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthApp } from './auth/AuthApp';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Point de montage React absent');
createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <AuthApp />
    </BrowserRouter>
  </StrictMode>,
);
