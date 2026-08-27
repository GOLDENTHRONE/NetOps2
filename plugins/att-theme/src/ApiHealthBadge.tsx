import { Icon } from '@iconify/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import React, { useEffect, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

const THIS_PLUGIN = 'att-theme';
const CHECK_INTERVAL_MS = 60000;

function relativeTime(from: number | null): string {
  if (!from) {
    return 'never';
  }
  const secs = Math.floor((Date.now() - from) / 1000);
  if (secs < 5) {
    return 'just now';
  }
  if (secs < 60) {
    return `${secs}s ago`;
  }
  const mins = Math.floor(secs / 60);
  return `${mins}m ago`;
}

// Names of plugin packages that actually executed in the browser.
function activePluginNames(): string[] {
  const reg = (window as any).plugins;
  return reg && typeof reg === 'object' ? Object.keys(reg) : [];
}

export function ApiHealthBadge() {
  const [anchorEl, setAnchorEl] = useState<HTMLDivElement | null>(null);
  const [backendUp, setBackendUp] = useState<boolean>(false);
  const [backendPluginCount, setBackendPluginCount] = useState<number | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [checking, setChecking] = useState<boolean>(false);
  // Re-render every second so the "X ago" label stays truthful without any network call.
  const [, forceTick] = useState(0);
  const inFlight = useRef(false);

  // Real: plugins finished executing (Redux, no network).
  const pluginsLoaded = useSelector((state: any) => Boolean(state.plugins?.loaded));
  const activeNames = activePluginNames();
  const thisPluginActive = activeNames.some(n => n.toLowerCase().includes(THIS_PLUGIN));

  const checkHealth = async () => {
    if (inFlight.current) {
      return; // guard against overlapping calls (no extra burden)
    }
    inFlight.current = true;
    setChecking(true);
    try {
      // /plugins is unauthenticated and returns the JSON list the backend serves.
      const res = await fetch('/plugins', { method: 'GET' });
      setBackendUp(res.ok);
      if (res.ok) {
        try {
          const list = await res.json();
          setBackendPluginCount(Array.isArray(list) ? list.length : null);
        } catch {
          setBackendPluginCount(null);
        }
      }
      setCheckedAt(Date.now());
    } catch {
      setBackendUp(false);
      setCheckedAt(Date.now());
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, CHECK_INTERVAL_MS);
    const tick = setInterval(() => forceTick(t => t + 1), 1000);
    return () => {
      clearInterval(interval);
      clearInterval(tick);
    };
  }, []);

  // Overall health = backend reachable AND plugin system executed.
  const isHealthy = backendUp && pluginsLoaded;

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => setAnchorEl(event.currentTarget);
  const handleClose = () => setAnchorEl(null);
  const open = Boolean(anchorEl);

  return (
    <>
      <Box
        onClick={handleClick}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          mx: 1.5,
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
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{
          sx: {
            p: 2.5,
            width: 320,
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
                {isHealthy ? 'Healthy' : 'Degraded'}
              </Typography>
            </Box>
            <Button
              size="small"
              onClick={checkHealth}
              disabled={checking}
              startIcon={<Icon icon="mdi:refresh" className={checking ? 'spin' : undefined} />}
            >
              {checking ? 'Checking' : 'Refresh'}
            </Button>
          </Box>

          <Typography variant="caption" color="text.secondary">
            Last checked: {relativeTime(checkedAt)}
          </Typography>

          <Divider />

          <Typography variant="caption" fontWeight={700} color="text.secondary">
            LIVE CHECKS
          </Typography>

          <Box display="flex" flexDirection="column" gap={1}>
            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={1}>
                <Icon icon="mdi:server-network" width={18} />
                <Typography variant="body2">Backend (/plugins)</Typography>
              </Box>
              <Chip
                label={backendUp ? 'Reachable' : 'Down'}
                color={backendUp ? 'success' : 'error'}
                size="small"
                variant="outlined"
              />
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={1}>
                <Icon icon="mdi:puzzle" width={18} />
                <Typography variant="body2">Plugin system</Typography>
              </Box>
              <Chip
                label={pluginsLoaded ? 'Loaded' : 'Loading'}
                color={pluginsLoaded ? 'success' : 'warning'}
                size="small"
                variant="outlined"
              />
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={1}>
                <Icon icon="mdi:server" width={18} />
                <Typography variant="body2">Served by backend</Typography>
              </Box>
              <Chip
                label={backendPluginCount === null ? 'unknown' : `${backendPluginCount} plugins`}
                color="info"
                size="small"
                variant="outlined"
              />
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={1}>
                <Icon icon="mdi:application-cog" width={18} />
                <Typography variant="body2">Active in browser</Typography>
              </Box>
              <Chip
                label={`${activeNames.length} plugins`}
                color="info"
                size="small"
                variant="outlined"
              />
            </Box>

            <Box display="flex" justifyContent="space-between" alignItems="center">
              <Box display="flex" alignItems="center" gap={1}>
                <Icon icon="mdi:palette" width={18} />
                <Typography variant="body2">att-theme</Typography>
              </Box>
              <Chip
                label={thisPluginActive ? 'Active' : 'Not found'}
                color={thisPluginActive ? 'success' : 'error'}
                size="small"
                variant="outlined"
              />
            </Box>
          </Box>
        </Box>
      </Popover>
    </>
  );
}
