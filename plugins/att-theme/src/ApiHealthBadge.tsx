import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import React, { useEffect, useState } from 'react';

export function ApiHealthBadge() {
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  const [isHealthy, setIsHealthy] = useState<boolean>(true);
  const [lastChecked, setLastChecked] = useState<string>('Just now');

  const checkHealth = async () => {
    try {
      const res = await fetch('/config', { method: 'GET' });
      setIsHealthy(res.ok);
      setLastChecked('Just now');
    } catch {
      setIsHealthy(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const open = Boolean(anchorEl);

  return (
    <>
      <Box
        onClick={handleClick}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.5,
          borderRadius: '16px',
          backgroundColor: isHealthy ? 'rgba(76, 175, 80, 0.08)' : 'rgba(244, 67, 54, 0.08)',
          cursor: 'pointer',
          '&:hover': {
            backgroundColor: isHealthy ? 'rgba(76, 175, 80, 0.16)' : 'rgba(244, 67, 54, 0.16)',
          },
        }}
      >
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: isHealthy ? '#4caf50' : '#f44336',
          }}
        />
        <Typography variant="caption" fontWeight={600} color="text.primary">
          API
        </Typography>
      </Box>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'left',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'left',
        }}
        PaperProps={{
          sx: {
            p: 2.5,
            width: 300,
            borderRadius: '16px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
          },
        }}
      >
        <Box display="flex" flexDirection="column" gap={2}>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <Box display="flex" alignItems="center" gap={1}>
              <Icon
                icon={isHealthy ? 'mdi:check-circle' : 'mdi:alert-circle'}
                color={isHealthy ? '#4caf50' : '#f44336'}
                width={22}
              />
              <Typography variant="subtitle1" fontWeight={700}>
                {isHealthy ? 'Healthy' : 'Unhealthy'}
              </Typography>
            </Box>
            <Button size="small" onClick={checkHealth} startIcon={<Icon icon="mdi:refresh" />}>
              Refresh
            </Button>
          </Box>

          <Typography variant="caption" color="text.secondary">
            Last checked: {lastChecked}
          </Typography>

          <Divider />

          <Typography variant="caption" fontWeight={700} color="text.secondary">
            SERVICES
          </Typography>

          <Box display="flex" flexDirection="column" gap={1}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={1}>
                <Icon icon="mdi:server-network" width={18} />
                <Typography variant="body2">Go Backend</Typography>
              </Box>
              <Chip label="Operational" color="success" size="small" variant="outlined" />
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={1}>
                <Icon icon="mdi:kubernetes" width={18} />
                <Typography variant="body2">K8s API Server</Typography>
              </Box>
              <Chip label="Operational" color="success" size="small" variant="outlined" />
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={1}>
                <Icon icon="mdi:puzzle" width={18} />
                <Typography variant="body2">Plugin System</Typography>
              </Box>
              <Chip label="Loaded" color="info" size="small" variant="outlined" />
            </Box>
          </Box>
        </Box>
      </Popover>
    </>
  );
}
