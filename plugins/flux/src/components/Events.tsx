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

import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  DateLabel,
  Loader,
  SectionBox,
  SimpleTable,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import { InputAdornment, TextField } from '@mui/material';
import React from 'react';
import { ICONS } from '../flux/icon';
import { NA, SectionEmpty } from './common';
import { ErrorState } from './errors';
import { Pill, PillTone, Surface } from './ui';

const { ResourceClasses } = K8s;

function eventTone(type?: string): PillTone {
  if (type === 'Normal') {
    return 'success';
  }
  if (type === 'Warning') {
    return 'warning';
  }
  return 'error';
}

function eventIcon(type?: string): string {
  if (type === 'Normal') {
    return ICONS.statusReady;
  }
  if (type === 'Warning') {
    return ICONS.warning;
  }
  return ICONS.statusError;
}

function eventTime(event: any): string | undefined {
  const json = event.jsonData ?? {};
  return (
    json.lastTimestamp ?? json.eventTime ?? json.firstTimestamp ?? json.metadata?.creationTimestamp
  );
}

/**
 * The events of this resource: color coded by severity (green for normal
 * activity, amber for warnings, red for anything else), newest first, with
 * a quick text filter over reason and message.
 */
export function FluxEventsSection(props: { item: any }) {
  const { item } = props;
  const name = item.metadata?.name;
  const namespace = item.metadata?.namespace;
  const kind = item.jsonData?.kind;
  const [query, setQuery] = React.useState('');

  const [events, error] = (ResourceClasses as Record<string, any>).Event.useList({
    namespace,
    fieldSelector: `involvedObject.kind=${kind},involvedObject.name=${name}${
      namespace ? `,involvedObject.namespace=${namespace}` : ''
    }`,
  });

  const filtered = React.useMemo(() => {
    const sorted = [...(events ?? [])].sort((a: any, b: any) =>
      (eventTime(b) ?? '').localeCompare(eventTime(a) ?? '')
    );
    if (!query) {
      return sorted;
    }
    const terms = query.toLowerCase().split(/\s+/);
    return sorted.filter((event: any) => {
      const json = event.jsonData ?? {};
      const haystack = [json.type, json.reason, json.message, json.source?.component]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return terms.every(term => haystack.includes(term));
    });
  }, [events, query]);

  return (
    <SectionBox title={`Events${events ? ` (${events.length})` : ''}`}>
      {error ? (
        <ErrorState error={error} what="the events of this resource" />
      ) : events === null ? (
        <Surface sx={{ p: 2 }}>
          <Loader title="Loading events" />
        </Surface>
      ) : events.length === 0 ? (
        <SectionEmpty message="No events recorded for this resource" />
      ) : (
        <>
          <TextField
            size="small"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter events by type, reason or message"
            sx={{ mb: 1.5, maxWidth: 420, width: '100%' }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Icon icon={ICONS.search} width="1rem" />
                </InputAdornment>
              ),
            }}
          />
          <Surface sx={{ px: 2, py: 0.5 }}>
            <SimpleTable
              columns={[
                {
                  label: 'Type',
                  gridTemplate: 'min-content',
                  getter: (event: any) => {
                    const type = event.jsonData?.type;
                    return (
                      <Pill tone={eventTone(type)} icon={eventIcon(type)}>
                        {type ?? 'Unknown'}
                      </Pill>
                    );
                  },
                },
                {
                  label: 'Reason',
                  gridTemplate: 'min-content',
                  getter: (event: any) => event.jsonData?.reason ?? <NA />,
                },
                {
                  label: 'Message',
                  gridTemplate: '2fr',
                  getter: (event: any) => event.jsonData?.message ?? <NA />,
                },
                {
                  label: 'Count',
                  gridTemplate: 'min-content',
                  getter: (event: any) => event.jsonData?.count ?? 1,
                },
                {
                  label: 'Last seen',
                  gridTemplate: 'min-content',
                  getter: (event: any) => {
                    const time = eventTime(event);
                    return time ? <DateLabel date={time} format="mini" /> : <NA />;
                  },
                },
              ]}
              data={filtered}
            />
          </Surface>
        </>
      )}
    </SectionBox>
  );
}
