import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Box';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

export function ThemeToggle() {
  const dispatch = useDispatch();
  const themeName = useSelector((state: any) => state.theme?.name || '');
  const isDark = themeName.toLowerCase().includes('dark');

  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const toggleTheme = (targetMode: 'light' | 'dark') => {
    const nextTheme = targetMode === 'dark' ? 'AT&T Dark' : 'AT&T Light';
    dispatch({ type: 'theme/setTheme', payload: nextTheme });
  };

  const open = Boolean(anchorEl);
  const id = open ? 'theme-popover' : undefined;

  return (
    <>
      <Tooltip title={isDark ? 'Switch to light' : 'Switch to dark'}>
        <IconButton
          onClick={handleClick}
          size="medium"
          sx={{
            color: 'inherit',
            borderRadius: '50%',
            p: 1,
            backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
            '&:hover': {
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.08)',
            },
          }}
        >
          <Icon icon={isDark ? 'mdi:weather-night' : 'mdi:weather-sunny'} width={20} height={20} />
        </IconButton>
      </Tooltip>

      <Popover
        id={id}
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        PaperProps={{
          sx: {
            p: 2,
            width: 260,
            borderRadius: '12px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          },
        }}
      >
        <Box display="flex" flexDirection="column" gap={2}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Typography variant="subtitle2" fontWeight={600}>
              Theme
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {themeName}
            </Typography>
          </Box>

          <Box display="flex" gap={1} bgcolor="action.hover" p={0.5} borderRadius="8px">
            <Button
              fullWidth
              size="small"
              variant={!isDark ? 'contained' : 'text'}
              onClick={() => toggleTheme('light')}
              startIcon={<Icon icon="mdi:weather-sunny" />}
              sx={{
                borderRadius: '6px',
                textTransform: 'none',
                boxShadow: !isDark ? 1 : 0,
              }}
            >
              Light
            </Button>
            <Button
              fullWidth
              size="small"
              variant={isDark ? 'contained' : 'text'}
              onClick={() => toggleTheme('dark')}
              startIcon={<Icon icon="mdi:weather-night" />}
              sx={{
                borderRadius: '6px',
                textTransform: 'none',
                boxShadow: isDark ? 1 : 0,
              }}
            >
              Dark
            </Button>
          </Box>

          <Button
            fullWidth
            size="small"
            color="error"
            variant="outlined"
            onClick={() => {
              toggleTheme('light');
              handleClose();
            }}
            sx={{ borderRadius: '8px', textTransform: 'none', mt: 1 }}
          >
            Reset to default
          </Button>
        </Box>
      </Popover>
    </>
  );
}
