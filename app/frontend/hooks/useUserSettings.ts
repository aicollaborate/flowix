'use client';

import { useState, useEffect, useCallback } from 'react';
import { settings as tauriSettings } from '../lib/tauri/client';
import {
  USER_SETTINGS_KEYS,
  DEFAULT_USER_SETTINGS,
  type UserSettings,
  type UserSettingsKey,
} from '../constants';

export function useUserSettings() {
  const [localSettings, setSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      try {
        const result = await tauriSettings.getAll();
        if (result?.settings) {
          const loaded: Partial<UserSettings> = {};

          if (result.settings[USER_SETTINGS_KEYS.CUSTOM_INSTRUCTION]) {
            loaded.customInstruction = result.settings[USER_SETTINGS_KEYS.CUSTOM_INSTRUCTION];
          }
          if (result.settings[USER_SETTINGS_KEYS.SELECTED_TAGS]) {
            loaded.selectedTags = JSON.parse(result.settings[USER_SETTINGS_KEYS.SELECTED_TAGS]);
          }
          if (result.settings[USER_SETTINGS_KEYS.RESPONSE_LENGTH]) {
            loaded.responseLength = result.settings[USER_SETTINGS_KEYS.RESPONSE_LENGTH];
          }
          if (result.settings[USER_SETTINGS_KEYS.PREFERRED_LANGUAGE]) {
            loaded.preferredLanguage = result.settings[USER_SETTINGS_KEYS.PREFERRED_LANGUAGE];
          }
          if (result.settings[USER_SETTINGS_KEYS.USER_NAME]) {
            loaded.userName = result.settings[USER_SETTINGS_KEYS.USER_NAME];
          }
          if (result.settings[USER_SETTINGS_KEYS.USER_EMAIL]) {
            loaded.userEmail = result.settings[USER_SETTINGS_KEYS.USER_EMAIL];
          }
          if (result.settings[USER_SETTINGS_KEYS.AGENT_MODEL]) {
            loaded.agentModel = result.settings[USER_SETTINGS_KEYS.AGENT_MODEL];
          }
          if (result.settings[USER_SETTINGS_KEYS.AGENT_API_URL]) {
            loaded.agentApiUrl = result.settings[USER_SETTINGS_KEYS.AGENT_API_URL];
          }
          if (result.settings[USER_SETTINGS_KEYS.AGENT_API_KEY]) {
            loaded.agentApiKey = result.settings[USER_SETTINGS_KEYS.AGENT_API_KEY];
          }
          if (result.settings[USER_SETTINGS_KEYS.FONT_FAMILY]) {
            loaded.fontFamily = result.settings[USER_SETTINGS_KEYS.FONT_FAMILY];
          }
          if (result.settings[USER_SETTINGS_KEYS.FONT_SIZE]) {
            const n = Number(result.settings[USER_SETTINGS_KEYS.FONT_SIZE]);
            if (!Number.isNaN(n)) loaded.fontSize = n;
          }
          if (result.settings[USER_SETTINGS_KEYS.LINE_HEIGHT]) {
            const n = Number(result.settings[USER_SETTINGS_KEYS.LINE_HEIGHT]);
            if (!Number.isNaN(n)) loaded.lineHeight = n;
          }
          if (result.settings[USER_SETTINGS_KEYS.THEME]) {
            loaded.theme = result.settings[USER_SETTINGS_KEYS.THEME] as UserSettings['theme'];
          }

          setSettings(prev => ({ ...prev, ...loaded }));
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadSettings();
  }, []);

  const saveSetting = useCallback(async (key: UserSettingsKey, value: string) => {
    try {
      await tauriSettings.set(key, value);
      setSettings(prev => {
        const newSettings = { ...prev };
        if (key === USER_SETTINGS_KEYS.SELECTED_TAGS) {
          newSettings.selectedTags = JSON.parse(value);
        } else if (key === USER_SETTINGS_KEYS.FONT_SIZE || key === USER_SETTINGS_KEYS.LINE_HEIGHT) {
          const n = Number(value);
          if (!Number.isNaN(n)) (newSettings as any)[key] = n;
        } else {
          (newSettings as any)[key] = value;
        }
        return newSettings;
      });
    } catch (error) {
      console.error('Failed to save setting:', error);
    }
  }, []);

  const updateSettings = useCallback(async (updates: Partial<UserSettings>) => {
    try {
      const settingsToSave: Record<string, string> = {};

      if (updates.customInstruction !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.CUSTOM_INSTRUCTION] = updates.customInstruction;
      }
      if (updates.selectedTags !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.SELECTED_TAGS] = JSON.stringify(updates.selectedTags);
      }
      if (updates.responseLength !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.RESPONSE_LENGTH] = updates.responseLength;
      }
      if (updates.preferredLanguage !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.PREFERRED_LANGUAGE] = updates.preferredLanguage;
      }
      if (updates.userName !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.USER_NAME] = updates.userName;
      }
      if (updates.userEmail !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.USER_EMAIL] = updates.userEmail;
      }
      if (updates.agentModel !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.AGENT_MODEL] = updates.agentModel;
      }
      if (updates.agentApiUrl !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.AGENT_API_URL] = updates.agentApiUrl;
      }
      if (updates.agentApiKey !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.AGENT_API_KEY] = updates.agentApiKey;
      }
      if (updates.fontFamily !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.FONT_FAMILY] = updates.fontFamily;
      }
      if (updates.fontSize !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.FONT_SIZE] = String(updates.fontSize);
      }
      if (updates.lineHeight !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.LINE_HEIGHT] = String(updates.lineHeight);
      }
      if (updates.theme !== undefined) {
        settingsToSave[USER_SETTINGS_KEYS.THEME] = updates.theme;
      }

      await tauriSettings.setMultiple(settingsToSave);
      setSettings(prev => ({ ...prev, ...updates }));
    } catch (error) {
      console.error('Failed to update settings:', error);
    }
  }, []);

  return {
    settings: localSettings,
    isLoading,
    saveSetting,
    updateSettings,
  };
}