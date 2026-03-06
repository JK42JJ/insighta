import { BrowserRouter } from 'react-router-dom';
import { QueryProvider } from './providers/QueryProvider';
import { ThemeProvider } from './providers/ThemeProvider';
import { AuthProvider } from '@/features/auth/model/AuthContext';
import { Toaster } from '@/shared/ui/sonner';
import { AppRouter } from './router';
import '@/shared/i18n/config';
import './styles/index.css';

function App() {
  return (
    <BrowserRouter basename="/v2">
      <QueryProvider>
        <ThemeProvider>
          <AuthProvider>
            <AppRouter />
            <Toaster />
          </AuthProvider>
        </ThemeProvider>
      </QueryProvider>
    </BrowserRouter>
  );
}

export default App;
