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

import { describe, expect, it, vi } from 'vitest';
import { KubeObjectClass, KubeObjectInterface } from '../../KubeObject';
import { KubeList, KubeListUpdateEvent } from './KubeList';

class MockKubeObject implements KubeObjectInterface {
  apiVersion = 'v1';
  kind = 'MockKubeObject';
  metadata: any = {
    uid: 'mock-uid',
    resourceVersion: '1',
  };

  constructor(data: Partial<KubeObjectInterface>) {
    Object.assign(this, data);
  }
}

const cluster = 'cluster-name';

describe('KubeList.applyUpdate', () => {
  const itemClass = MockKubeObject as unknown as KubeObjectClass;
  const initialList: KubeList<any> = {
    kind: 'MockKubeList',
    apiVersion: 'v1',
    items: [
      { apiVersion: 'v1', kind: 'MockKubeObject', metadata: { uid: '1', resourceVersion: '1' } },
    ],
    metadata: {
      resourceVersion: '1',
    },
  };

  it('should add a new item on ADDED event', () => {
    const updateEvent: KubeListUpdateEvent<MockKubeObject> = {
      type: 'ADDED',
      object: {
        apiVersion: 'v1',
        kind: 'MockKubeObject',
        metadata: { uid: '2', resourceVersion: '2' },
      },
    };

    const updatedList = KubeList.applyUpdate(initialList, updateEvent, itemClass, cluster);

    expect(updatedList.items).toHaveLength(2);
    expect(updatedList.items[1].metadata.uid).toBe('2');
    expect(updatedList.items[1] instanceof MockKubeObject).toBe(true);
  });

  it('preserves resourceVersion on an ERROR (410) event instead of clobbering it', () => {
    const errorEvent = {
      type: 'ERROR',
      object: {
        apiVersion: 'v1',
        kind: 'Status',
        code: 410,
        reason: 'Expired',
        metadata: {},
      },
    } as unknown as KubeListUpdateEvent<MockKubeObject>;

    const updatedList = KubeList.applyUpdate(initialList, errorEvent, itemClass, cluster);

    // The list's resourceVersion must survive (not become undefined), so the next
    // watch resume is not broken; items are left unchanged.
    expect(updatedList.metadata.resourceVersion).toBe('1');
    expect(updatedList.items).toHaveLength(1);
  });

  it('advances resourceVersion on a BOOKMARK event without changing items or logging', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bookmarkEvent = {
      type: 'BOOKMARK',
      object: {
        apiVersion: 'v1',
        kind: 'MockKubeObject',
        // A real BOOKMARK carries only an up-to-date resourceVersion, no item data.
        metadata: { resourceVersion: '5' },
      },
    } as unknown as KubeListUpdateEvent<MockKubeObject>;

    const updatedList = KubeList.applyUpdate(initialList, bookmarkEvent, itemClass, cluster);

    // resourceVersion advances (so the next resume is fresh), items are untouched,
    // and no error is logged (it is a known type, not "Unknown update type").
    expect(updatedList.metadata.resourceVersion).toBe('5');
    expect(updatedList.items).toHaveLength(1);
    expect(updatedList.items[0].metadata.uid).toBe('1');
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('should modify an existing item on MODIFIED event', () => {
    const updateEvent: KubeListUpdateEvent<MockKubeObject> = {
      type: 'MODIFIED',
      object: {
        apiVersion: 'v1',
        kind: 'MockKubeObject',
        metadata: { uid: '1', resourceVersion: '2' },
      },
    };

    const updatedList = KubeList.applyUpdate(initialList, updateEvent, itemClass, cluster);

    expect(updatedList.items).toHaveLength(1);
    expect(updatedList.items[0].metadata.resourceVersion).toBe('2');
    expect(updatedList.items[0] instanceof MockKubeObject).toBe(true);
  });

  it('should keep pagination metadata when applying watch updates', () => {
    const paginatedList: KubeList<any> = {
      ...initialList,
      metadata: {
        resourceVersion: '1',
        continue: 'continue-token',
        remainingItemCount: 10,
      },
    };
    const updateEvent: KubeListUpdateEvent<MockKubeObject> = {
      type: 'MODIFIED',
      object: {
        apiVersion: 'v1',
        kind: 'MockKubeObject',
        metadata: { uid: '1', resourceVersion: '2' },
      },
    };

    const updatedList = KubeList.applyUpdate(paginatedList, updateEvent, itemClass, cluster);

    expect(updatedList.metadata).toEqual({
      resourceVersion: '2',
      continue: 'continue-token',
      remainingItemCount: 10,
    });
  });

  it('should add a new item on MODIFIED event', () => {
    const updateEvent: KubeListUpdateEvent<MockKubeObject> = {
      type: 'MODIFIED',
      object: {
        apiVersion: 'v1',
        kind: 'MockKubeObject',
        metadata: { uid: '3', resourceVersion: '3' },
      },
    };

    const updatedList = KubeList.applyUpdate(initialList, updateEvent, itemClass, cluster);

    expect(updatedList.items).toHaveLength(2);
    expect(updatedList.items[1].metadata.uid).toBe('3');
    expect(updatedList.items[1] instanceof MockKubeObject).toBe(true);
  });

  it('should delete an existing item on DELETED event', () => {
    const updateEvent: KubeListUpdateEvent<MockKubeObject> = {
      type: 'DELETED',
      object: {
        apiVersion: 'v1',
        kind: 'MockKubeObject',
        metadata: { uid: '1', resourceVersion: '2' },
      },
    };

    const updatedList = KubeList.applyUpdate(initialList, updateEvent, itemClass, cluster);

    expect(updatedList.items).toHaveLength(0);
  });

  it('should log an error on ERROR event', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updateEvent: KubeListUpdateEvent<MockKubeObject> = {
      type: 'ERROR',
      object: {
        apiVersion: 'v1',
        kind: 'MockKubeObject',
        metadata: { uid: '1', resourceVersion: '2' },
      },
    };

    KubeList.applyUpdate(initialList, updateEvent, itemClass, cluster);

    expect(consoleErrorSpy).toHaveBeenCalledWith('Error in update', updateEvent);
    consoleErrorSpy.mockRestore();
  });

  it('should log an error on unknown event type', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const updateEvent: KubeListUpdateEvent<MockKubeObject> = {
      type: 'UNKNOWN' as any,
      object: {
        apiVersion: 'v1',
        kind: 'MockKubeObject',
        metadata: { uid: '1', resourceVersion: '2' },
      },
    };

    KubeList.applyUpdate(initialList, updateEvent, itemClass, cluster);

    expect(consoleErrorSpy).toHaveBeenCalledWith('Unknown update type', updateEvent);
    consoleErrorSpy.mockRestore();
  });

  // P1 (#15): applyUpdate must bump the live resourceVersion but must NOT change
  // listResourceVersion (the watch identity), so per-event RV bumps don't rebuild
  // the watch socket.
  describe('#15 listResourceVersion (watch identity) is preserved across events', () => {
    const listWithGen: KubeList<any> = {
      ...initialList,
      metadata: { resourceVersion: '10', listResourceVersion: '10' },
    };

    it.each([
      ['ADDED', { uid: '2', resourceVersion: '11' }],
      ['MODIFIED', { uid: '1', resourceVersion: '11' }],
      ['DELETED', { uid: '1', resourceVersion: '11' }],
    ] as const)('%s bumps resourceVersion but keeps listResourceVersion', (type, meta) => {
      const event = {
        type,
        object: { apiVersion: 'v1', kind: 'MockKubeObject', metadata: meta },
      } as unknown as KubeListUpdateEvent<MockKubeObject>;

      const updated = KubeList.applyUpdate(listWithGen, event, itemClass, cluster);

      expect(updated.metadata.resourceVersion).toBe('11'); // live RV advances
      expect(updated.metadata.listResourceVersion).toBe('10'); // identity unchanged
    });

    it('a burst of events never changes listResourceVersion', () => {
      let list = listWithGen;
      for (let i = 12; i < 27; i++) {
        list = KubeList.applyUpdate(
          list,
          {
            type: 'MODIFIED',
            object: {
              apiVersion: 'v1',
              kind: 'MockKubeObject',
              metadata: { uid: '1', resourceVersion: String(i) },
            },
          } as unknown as KubeListUpdateEvent<MockKubeObject>,
          itemClass,
          cluster
        );
      }
      expect(list.metadata.resourceVersion).toBe('26'); // advanced through the burst
      expect(list.metadata.listResourceVersion).toBe('10'); // identity stable across 15 events
    });

    it('a list without listResourceVersion stays without it (backward-safe)', () => {
      const updated = KubeList.applyUpdate(
        initialList, // no listResourceVersion
        {
          type: 'MODIFIED',
          object: {
            apiVersion: 'v1',
            kind: 'MockKubeObject',
            metadata: { uid: '1', resourceVersion: '2' },
          },
        } as unknown as KubeListUpdateEvent<MockKubeObject>,
        itemClass,
        cluster
      );
      expect(updated.metadata.listResourceVersion).toBeUndefined();
    });
  });
});
