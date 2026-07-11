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

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { castDraft } from 'immer';

/**
 * A tab that plugins can add to the Home page, next to the built-in
 * "All Clusters" and "Applications" tabs.
 */
export interface HomeTab {
  /** Unique id for the tab. Also used as the tab selection value. */
  id: string;
  /** Label displayed in the tab. */
  label: string;
  /**
   * An iconify string for the tab icon.
   *
   * @see https://icon-sets.iconify.design/mdi/ for icons.
   */
  icon?: string;
  /** Component rendered when the tab is selected. */
  component: React.ComponentType<{}>;
}

export interface HomeTabsState {
  /** Tabs registered by plugins, keyed by id. */
  tabs: { [id: string]: HomeTab };
}

const initialState: HomeTabsState = {
  tabs: {},
};

const homeTabsSlice = createSlice({
  name: 'homeTabs',
  initialState,
  reducers: {
    /**
     * Adds or replaces (matched by id) a plugin provided Home page tab.
     */
    setHomeTab(state, action: PayloadAction<HomeTab>) {
      state.tabs[action.payload.id] = castDraft(action.payload);
    },
  },
});

export const { setHomeTab } = homeTabsSlice.actions;

export { homeTabsSlice };

export default homeTabsSlice.reducer;
