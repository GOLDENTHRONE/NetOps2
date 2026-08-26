import { Icon } from '@iconify/react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import Typography from '@mui/material/Typography';
import React, { useState } from 'react';
import { useSelector } from 'react-redux';

export function UserProfileAvatar() {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const cluster = useSelector((state: any) => state.config?.cluster);
  const user = useSelector((state: any) => state.filter?.user || 'User');

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const open = Boolean(anchorEl);

  return (
    <>
      <Avatar
        onClick={handleClick}
        sx={{
          bgcolor: '#009fdb',
          color: '#ffffff',
          width: 36,
          height: 36,
          cursor: 'pointer',
          fontWeight: 700,
          fontSize: '15px',
          boxShadow: '0 2px 8px rgba(0,159,219,0.3)',
          '&:hover': {
            opacity: 0.9,
          },
        }}
      >
        {user.charAt(0).toUpperCase()}
      </Avatar>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'right',
        }}
        PaperProps={{
          sx: {
            p: 2,
            width: 280,
            borderRadius: '16px',
            boxShadow: '0 8px 30px rgba(0,0,0,0.14)',
          },
        }}
      >
        <Box display="flex" flexDirection="column" gap={1.5}>
          <Box display="flex" alignItems="center" gap={1.5}>
            <Avatar
              sx={{
                bgcolor: '#009fdb',
                color: '#ffffff',
                width: 48,
                height: 48,
                fontWeight: 700,
                fontSize: '20px',
              }}
            >
              {user.charAt(0).toUpperCase()}
            </Avatar>
            <Box overflow="hidden">
              <Box display="flex" alignItems="center" gap={1}>
                <Typography variant="subtitle2" fontWeight={700} noWrap>
                  {user}
                </Typography>
                <Chip
                  label={cluster ? 'Cluster Admin' : 'User'}
                  size="small"
                  color="primary"
                  variant="soft"
                  sx={{ height: 20, fontSize: '11px' }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary" noWrap display="block">
                {cluster ? `Cluster: ${cluster}` : 'NetOps Platform'}
              </Typography>
            </Box>
          </Box>

          <Divider />

          <MenuItem onClick={handleClose} sx={{ borderRadius: '8px' }}>
            <ListItemIcon>
              <Icon icon="mdi:account-outline" width={20} />
            </ListItemIcon>
            <ListItemText primary="Account" />
          </MenuItem>

          <MenuItem onClick={handleClose} sx={{ borderRadius: '8px' }}>
            <ListItemIcon>
              <Icon icon="mdi:account-switch-outline" width={20} />
            </ListItemIcon>
            <ListItemText primary="Use a different account" />
          </MenuItem>

          <Divider />

          <MenuItem
            onClick={() => {
              handleClose();
              window.location.reload();
            }}
            sx={{ borderRadius: '8px', color: 'error.main' }}
          >
            <ListItemIcon sx={{ color: 'error.main' }}>
              <Icon icon="mdi:logout" width={20} />
            </ListItemIcon>
            <ListItemText primary="Log out" />
          </MenuItem>
        </Box>
      </Popover>
    </>
  );
}
