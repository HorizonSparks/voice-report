import { createTheme } from '@mui/material/styles';

const theme = createTheme({
  palette: {
    primary: {
      main: '#F99440',
      dark: '#E07C26',
      contrastText: '#fff',
    },
    secondary: {
      main: '#48484A',
      dark: '#3A3A3C',
      contrastText: '#F99440',
    },
    error: {
      main: '#e74c3c',
    },
    warning: {
      main: '#E8922A',
      light: '#FEF8F1',
    },
    success: {
      main: '#16a34a',
      light: '#f0fdf4',
    },
    background: {
      default: '#ECE5DD',
      paper: '#fff',
    },
    text: {
      primary: '#48484A',
      secondary: '#7C7568',
    },
    grey: {
      50: '#ECE5DD',
      100: '#F5F3F0',
      200: '#E8E4DE',
      300: '#D4CFC7',
      500: '#7C7568',
      700: '#3D3A35',
      900: '#1F1D1A',
    },
  },
  typography: {
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    h1: { fontWeight: 800 },
    h2: { fontWeight: 800 },
    h3: { fontWeight: 800 },
    h4: { fontWeight: 700 },
    button: { fontWeight: 700, textTransform: 'none' },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontWeight: 700,
          textTransform: 'none',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '2px solid #E8E4DE',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 700,
          fontSize: '11px',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 10,
          },
        },
      },
    },
  },
});

export default theme;
