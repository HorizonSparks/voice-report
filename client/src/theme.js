import { createTheme, alpha } from '@mui/material/styles';

const GREY = {
  0: '#FFFFFF',
  50: '#ECE5DD',
  100: '#F5F3F0',
  200: '#E8E4DE',
  300: '#D4CFC7',
  400: '#B0A99F',
  500: '#7C7568',
  600: '#636058',
  700: '#3D3A35',
  800: '#48484A',
  900: '#1F1D1A',
};

const PRIMARY = {
  lighter: '#FEE9D1',
  light: '#FDAB76',
  main: '#F99440',
  dark: '#E07C26',
  darker: '#7A3E10',
};

const SECONDARY = {
  lighter: '#8E8E90',
  light: '#6A6A6C',
  main: '#48484A',
  dark: '#3A3A3C',
  darker: '#2A2A2C',
};

const theme = createTheme({
  palette: {
    primary: {
      lighter: PRIMARY.lighter,
      light: PRIMARY.light,
      main: PRIMARY.main,
      dark: PRIMARY.dark,
      darker: PRIMARY.darker,
      contrastText: '#fff',
    },
    secondary: {
      lighter: SECONDARY.lighter,
      light: SECONDARY.light,
      main: SECONDARY.main,
      dark: SECONDARY.dark,
      darker: SECONDARY.darker,
      contrastText: '#F99440',
    },
    error: {
      lighter: '#FFE9D5',
      light: '#FFAC82',
      main: '#e74c3c',
      dark: '#B71D18',
    },
    warning: {
      lighter: '#FEF8F1',
      light: '#FFD666',
      main: '#E8922A',
      dark: '#B76E00',
    },
    success: {
      lighter: '#D8FBDE',
      light: '#86E8AB',
      main: '#16a34a',
      dark: '#1B806A',
    },
    info: {
      lighter: '#CAFDF5',
      light: '#61F3F3',
      main: '#00B8D9',
      dark: '#006C9C',
    },
    grey: GREY,
    background: {
      default: '#ECE5DD',
      paper: '#FFFFFF',
      neutral: GREY[200],
    },
    text: {
      primary: '#48484A',
      secondary: '#7C7568',
      disabled: GREY[500],
    },
    divider: alpha(GREY[500], 0.24),
    action: {
      hover: alpha(GREY[500], 0.08),
      selected: alpha(GREY[500], 0.16),
      disabled: alpha(GREY[500], 0.8),
      disabledBackground: alpha(GREY[500], 0.24),
      focus: alpha(GREY[500], 0.24),
    },
  },
  typography: {
    fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    h1: { fontWeight: 800, lineHeight: 80 / 64, fontSize: '2.5rem' },
    h2: { fontWeight: 800, lineHeight: 64 / 48, fontSize: '2rem' },
    h3: { fontWeight: 700, lineHeight: 1.5, fontSize: '1.5rem' },
    h4: { fontWeight: 700, lineHeight: 1.5, fontSize: '1.25rem' },
    h5: { fontWeight: 700, lineHeight: 1.5, fontSize: '1.125rem' },
    h6: { fontWeight: 700, lineHeight: 28 / 18, fontSize: '1rem' },
    subtitle1: { fontWeight: 600, lineHeight: 1.5, fontSize: '1rem' },
    subtitle2: { fontWeight: 600, lineHeight: 22 / 14, fontSize: '0.875rem' },
    body1: { lineHeight: 1.5, fontSize: '1rem' },
    body2: { lineHeight: 22 / 14, fontSize: '0.875rem' },
    caption: { lineHeight: 1.5, fontSize: '0.75rem' },
    overline: { fontWeight: 700, lineHeight: 1.5, fontSize: '0.75rem', textTransform: 'uppercase' },
    button: { fontWeight: 700, lineHeight: 24 / 14, fontSize: '0.875rem', textTransform: 'none' },
  },
  shape: {
    borderRadius: 8,
  },
  shadows: [
    'none',
    `0 1px 2px 0 ${alpha(GREY[500], 0.16)}`,
    `0 1px 2px 0 ${alpha(GREY[500], 0.16)}`,
    `0 2px 4px 0 ${alpha(GREY[500], 0.16)}`,
    `0 4px 8px 0 ${alpha(GREY[500], 0.16)}`,
    `0 8px 16px 0 ${alpha(GREY[500], 0.16)}`,
    `0 12px 24px -4px ${alpha(GREY[500], 0.16)}`,
    `0 16px 32px -4px ${alpha(GREY[500], 0.16)}`,
    `0 20px 40px -4px ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
    `0 24px 48px 0 ${alpha(GREY[500], 0.16)}`,
  ],
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontWeight: 700,
          textTransform: 'none',
        },
        containedPrimary: {
          boxShadow: `0 8px 16px 0 ${alpha(PRIMARY.main, 0.24)}`,
          '&:hover': {
            boxShadow: `0 8px 16px 0 ${alpha(PRIMARY.main, 0.48)}`,
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 16,
          boxShadow: `0 0 2px 0 ${alpha(GREY[500], 0.2)}, 0 12px 24px -4px ${alpha(GREY[500], 0.12)}`,
          border: 'none',
          position: 'relative',
          zIndex: 0,
        },
      },
    },
    MuiPaper: {
      defaultProps: {
        elevation: 0,
      },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
        rounded: {
          borderRadius: 16,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 600,
          fontSize: '0.75rem',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 8,
          },
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 24,
          '&:last-child': {
            paddingBottom: 24,
          },
        },
      },
    },
  },
});

export default theme;
