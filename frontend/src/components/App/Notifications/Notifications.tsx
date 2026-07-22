/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import bellIcon from '@iconify/icons-mdi/bell';
import { Icon } from '@iconify/react';
import Badge from '@mui/material/Badge';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import { useTheme } from '@mui/material/styles';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { useHistory } from 'react-router';
import { useClustersConf, useClustersVersion } from '../../../lib/k8s';
import { createRouteURL } from '../../../lib/router/createRouteURL';
import { useTypedSelector } from '../../../redux/hooks';
import {
  loadNotifications,
  Notification,
  NotificationIface,
  setNotifications,
  updateNotifications,
} from './notificationsSlice';

/** Format a date as relative time (e.g. "2m ago", "3h ago", "5d ago"). */
function timeAgo(date: number | string): string {
  const now = Date.now();
  const then = typeof date === 'number' ? date : new Date(date).getTime();
  const diffS = Math.max(0, Math.floor((now - then) / 1000));
  if (diffS < 60) return `${diffS}s ago`;
  const diffM = Math.floor(diffS / 60);
  if (diffM < 60) return `${diffM}m ago`;
  const diffH = Math.floor(diffM / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  const diffMo = Math.floor(diffD / 30);
  return `${diffMo}mo ago`;
}

/** Single notification card. */
function NotificationCard({
  notification,
  onMarkRead,
  onClick,
}: {
  notification: NotificationIface;
  onMarkRead: (n: NotificationIface) => void;
  onClick: (n: NotificationIface) => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const isUnread = !notification.seen;

  // Use same cloud icons as the All Clusters table
  const iconName = notification.id?.startsWith('cluster-not-active')
    ? 'mdi:cloud-off'
    : 'mdi:cloud-alert';
  const iconColor = notification.id?.startsWith('cluster-not-active')
    ? theme.palette.error.main
    : theme.palette.warning.main;

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1.5,
        p: 2,
        mx: 2,
        mb: 1.5,
        borderRadius: '12px',
        border: '1px solid',
        borderColor: isUnread ? theme.palette.primary.main : theme.palette.divider,
        backgroundColor: isUnread
          ? `${theme.palette.primary.main}06`
          : theme.palette.background.paper,
        cursor: notification.url ? 'pointer' : 'default',
        transition: 'background-color 0.15s',
        '&:hover': {
          backgroundColor: isUnread
            ? `${theme.palette.primary.main}12`
            : theme.palette.action.hover,
        },
      }}
      onClick={() => onClick(notification)}
    >
      {/* Icon — matches All Clusters table status icons */}
      <Box
        sx={{
          flexShrink: 0,
          width: 36,
          height: 36,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${iconColor}14`,
          mt: 0.25,
        }}
      >
        <Icon icon={iconName} width={18} height={18} color={iconColor} />
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Title + actions */}
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Typography
            variant="body2"
            sx={{
              fontWeight: isUnread ? 600 : 400,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              mr: 1,
            }}
            title={notification.message}
          >
            {notification.message || t('translation|No message')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
            {isUnread && (
              <Tooltip title={t('translation|Mark as read')}>
                <IconButton
                  size="small"
                  onClick={e => {
                    e.stopPropagation();
                    onMarkRead(notification);
                  }}
                  sx={{ color: theme.palette.success.main }}
                >
                  <Icon icon="mdi:check-circle-outline" width={20} height={20} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>

        {/* Cluster + time */}
        <Box sx={{ display: 'flex', gap: 0.75, mt: 0.5, alignItems: 'center' }}>
          {notification.cluster && (
            <Chip
              label={notification.cluster}
              size="small"
              sx={{ height: 20, fontSize: '0.7rem', maxWidth: 200 }}
              variant="outlined"
            />
          )}
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            {timeAgo(notification.date)}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

export default function Notifications() {
  const notifications = useTypedSelector(state => state.notifications.notifications);
  const dispatch = useDispatch();
  const clusters = useClustersConf();
  const { t } = useTranslation();
  const history = useHistory();
  const clusterList = useMemo(() => Object.values(clusters ?? {}), [clusters]);
  const [, clusterErrors] = useClustersVersion(clusterList);
  const prevClusterErrorsRef = useRef(clusterErrors);

  function describeClusterState(status?: number) {
    if (status === 401) {
      return t('translation|Authentication required');
    }
    if (status === 403) {
      return t('translation|Insufficient permissions');
    }
    return t('translation|Unavailable');
  }

  useEffect(() => {
    // Track whether clusterErrors ref changed (new poll) vs just notifications changed (user action).
    const clusterErrorsChanged = prevClusterErrorsRef.current !== clusterErrors;
    prevClusterErrorsRef.current = clusterErrors;

    let currentNotifications = notifications;
    let changed = false;

    // Hydrate from localStorage if redux store is empty (first mount).
    if (currentNotifications.length === 0) {
      currentNotifications = loadNotifications();
      changed = currentNotifications.length > 0;
    }

    // Preserve earliest "first seen" date per cluster before cleanup removes old-format entries.
    const clusterFirstSeen: Record<string, number | string> = {};
    for (const n of currentNotifications) {
      if (!n.id?.startsWith('cluster-not-active:') && !n.message?.includes('is not active')) {
        continue;
      }
      const cName =
        n.cluster ||
        clusterList.find(c => n.id?.startsWith(`cluster-not-active:${c.name}:`))?.name ||
        clusterList.find(c => n.message?.includes(c.name))?.name;
      if (!cName) continue;
      const nTime = typeof n.date === 'string' ? new Date(n.date).getTime() : (n.date as number);
      const prev = clusterFirstSeen[cName];
      if (
        prev === undefined ||
        nTime < (typeof prev === 'string' ? new Date(prev).getTime() : prev)
      ) {
        clusterFirstSeen[cName] = n.date;
      }
    }

    // --- CLEANUP: mark legacy + recovered as deleted ---
    // Use map (not filter) because setNotifications merges with old state via _.uniqBy.
    // Filtering would let mergeNotifications re-add the old version from state.
    currentNotifications = currentNotifications.map(n => {
      // Legacy old format ("Cluster X is not active") — mark deleted.
      // Fresh notifications will be created below if the error is still active.
      if (n.message?.includes('is not active') && !n.deleted) {
        changed = true;
        return { ...n, deleted: true };
      }
      // Cluster recovered (err === null) → mark all error notifications for this cluster deleted,
      // regardless of ID format (base64 or stable) or message format.
      if (n.cluster && !n.deleted) {
        const err = clusterErrors[n.cluster];
        if (
          err === null &&
          (n.id?.startsWith('cluster-not-active:') || n.message?.includes(' \u2014 '))
        ) {
          changed = true;
          return { ...n, deleted: true };
        }
      }
      // Also try matching by ID prefix for notifications with null cluster field.
      if (!n.cluster && !n.deleted && n.id?.startsWith('cluster-not-active:')) {
        const clusterName = clusterList.find(c =>
          n.id?.startsWith(`cluster-not-active:${c.name}:`)
        )?.name;
        if (clusterName && clusterErrors[clusterName] === null) {
          changed = true;
          return { ...n, deleted: true };
        }
      }
      return n;
    });

    // --- INSTANT ALERTS: cluster has error → ensure notification exists ---
    const notificationsToAdd: NotificationIface[] = [];

    for (const cluster of clusterList) {
      const clusterName = cluster.name;
      const err = clusterErrors[clusterName];

      // undefined = not yet probed; null = active. Only act on errors.
      if (err === undefined || err === null) {
        continue;
      }

      const statusText = describeClusterState(err?.status);
      const message = `${clusterName} — ${statusText}`;
      const stableId = `cluster-not-active:${clusterName}:${err?.status ?? 'down'}`;

      const existingIdx = currentNotifications.findIndex(n => n.id === stableId);
      if (existingIdx >= 0) {
        const existing = currentNotifications[existingIdx];
        // Only un-delete on new poll data (clusterErrorsChanged), not user actions.
        // Always fix stale cluster/message fields.
        const shouldUndelete = existing.deleted && clusterErrorsChanged;
        const shouldFixFields = !existing.cluster || existing.message !== message;
        if (shouldUndelete || shouldFixFields) {
          currentNotifications = currentNotifications.map((n, i) =>
            i === existingIdx
              ? {
                  ...n,
                  ...(shouldUndelete ? { deleted: false } : {}),
                  cluster: clusterName,
                  message,
                }
              : n
          );
          changed = true;
        }
      } else {
        // Use preserved first-seen date (shows how long cluster been down).
        const notification = new Notification({
          message,
          date: clusterFirstSeen[clusterName] ?? Date.now(),
          cluster: clusterName,
        });
        notification.url = createRouteURL('cluster', { cluster: clusterName });
        notification.id = stableId;
        changed = true;
        notificationsToAdd.push(notification.toJSON());
      }
    }

    if (changed) {
      dispatch(setNotifications(notificationsToAdd.concat(currentNotifications)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterErrors, clusterList, notifications]);

  const [areAllNotificationsInDeleteState, areThereUnseenNotifications, unreadCount] =
    useMemo(() => {
      const live = notifications.filter(n => !n.deleted);
      return [live.length === 0, live.some(n => !n.seen), live.filter(n => !n.seen).length];
    }, [notifications]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [tab, setTab] = useState<'unread' | 'all'>('unread');

  const handleOpen = () => {
    setDrawerOpen(true);
  };
  const handleClose = () => setDrawerOpen(false);

  function handleNotificationMarkAllRead() {
    const updated = notifications.map(n => {
      const copy = Object.assign(new Notification(), n);
      copy.seen = true;
      return copy;
    });
    dispatch(setNotifications(updated));
  }

  function handleMarkOneRead(notification: NotificationIface) {
    dispatch(updateNotifications({ ...notification, seen: true }));
  }

  function handleCardClick(notification: NotificationIface) {
    if (notification.url) {
      history.push(notification.url);
    }
    if (!notification.seen) {
      dispatch(updateNotifications({ ...notification, seen: true }));
    }
  }

  const visibleNotifications = useMemo(() => {
    const live = notifications.filter(n => !n.deleted);
    if (tab === 'unread') return live.filter(n => !n.seen);
    return live;
  }, [notifications, tab]);

  return (
    <>
      <IconButton
        aria-label={t('translation|Show notifications')}
        aria-haspopup="true"
        onClick={handleOpen}
        size="medium"
      >
        {!areAllNotificationsInDeleteState && areThereUnseenNotifications ? (
          <Badge variant="dot" color="error">
            <Tooltip title={t('translation|You have unread notifications')}>
              <Icon icon={bellIcon} />
            </Tooltip>
          </Badge>
        ) : (
          <Icon icon={bellIcon} />
        )}
      </IconButton>

      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={handleClose}
        disableScrollLock
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: 420 },
            maxWidth: '100vw',
            top: '64px',
            height: 'calc(100% - 64px)',
            borderRadius: { sm: '16px 0 0 16px' },
            display: 'flex',
            flexDirection: 'column',
          },
        }}
      >
        {/* Sticky header area */}
        <Box sx={{ flexShrink: 0 }}>
          {/* Header */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              px: 2.5,
              py: 2,
            }}
          >
            <IconButton onClick={handleClose} size="small" sx={{ mr: 0.5 }}>
              <Icon icon="mdi:close" width={20} height={20} />
            </IconButton>
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              {t('translation|Notifications')}
            </Typography>
            {unreadCount > 0 && (
              <Badge badgeContent={unreadCount} color="primary" sx={{ ml: 0.5 }} />
            )}
          </Box>

          {/* Action buttons */}
          <Box sx={{ display: 'flex', gap: 1, px: 2.5, pb: 1.5 }}>
            <Button
              size="small"
              variant="outlined"
              color="success"
              startIcon={<Icon icon="mdi:check-circle-outline" width={16} />}
              onClick={handleNotificationMarkAllRead}
              disabled={areAllNotificationsInDeleteState || !areThereUnseenNotifications}
              sx={{ textTransform: 'none', borderRadius: '20px', fontSize: '0.8rem' }}
            >
              {t('translation|Mark all read')}
            </Button>
          </Box>

          {/* Tabs */}
          <Box sx={{ px: 2.5, borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36 }}>
              <Tab
                value="unread"
                label={`${t('translation|Unread')} (${unreadCount})`}
                icon={<Icon icon="mdi:email-outline" width={16} />}
                iconPosition="start"
                sx={{ textTransform: 'none', minHeight: 36, py: 0 }}
              />
              <Tab
                value="all"
                label={t('translation|All')}
                icon={<Icon icon="mdi:eye-outline" width={16} />}
                iconPosition="start"
                sx={{ textTransform: 'none', minHeight: 36, py: 0 }}
              />
            </Tabs>
          </Box>
        </Box>

        {/* Notification list */}
        <Box sx={{ flex: 1, overflowY: 'auto', pt: 1.5 }}>
          {visibleNotifications.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 6, px: 3 }}>
              <Icon
                icon="mdi:bell-check-outline"
                width={48}
                height={48}
                color="inherit"
                style={{ opacity: 0.3 }}
              />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                {tab === 'unread'
                  ? t('translation|No unread notifications')
                  : t("translation|You don't have any notifications right now")}
              </Typography>
            </Box>
          ) : (
            visibleNotifications.map(n => (
              <NotificationCard
                key={n.id}
                notification={n}
                onMarkRead={handleMarkOneRead}
                onClick={handleCardClick}
              />
            ))
          )}
        </Box>
      </Drawer>
    </>
  );
}
