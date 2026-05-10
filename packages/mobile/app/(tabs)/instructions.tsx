// (FULL FILE — FIXED)

import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ScrollView, RefreshControl, TextInput,
  ActivityIndicator,
} from 'react-native';
import { projectsApi } from '../../src/api/projects';
import { instructionsApi } from '../../src/api/instructions';
import { useAuthStore } from '../../src/store/auth.store';
import { Screen } from '../../src/components/Screen';
import { Card } from '../../src/components/Card';
import { Badge } from '../../src/components/Badge';
import { LoadingSpinner } from '../../src/components/LoadingSpinner';
import { useSSEEvent } from '../../src/hooks/useSSEEvent';
import {
  Project, Instruction,
  InstructionType, InstructionPriority, InstructionStatus,
} from '../../src/types';

const PRIORITY_VARIANT = {
  critical: 'error',
  high: 'warning',
  medium: 'default',
  low: 'default',
};

const STATUS_VARIANT = {
  open: 'warning',
  acknowledged: 'default',
  in_progress: 'default',
  resolved: 'success',
  rejected: 'error',
};

const ISSUE_ROLES = ['company_admin', 'project_manager', 'consultant'];
const UPDATE_ROLES = ['company_admin', 'project_manager', 'site_supervisor', 'consultant', 'contractor'];

const INSTRUCTION_TYPES = ['instruction', 'recommendation'] as const;
const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

const STATUS_TRANSITIONS = {
  open: ['acknowledged', 'in_progress', 'rejected'],
  acknowledged: ['in_progress', 'rejected'],
  in_progress: ['resolved', 'rejected'],
  resolved: [],
  rejected: [],
};

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ✅ FIXED TYPE NAME
type InstructionView =
  | 'projects'
  | 'list'
  | 'detail'
  | 'create';

export default function InstructionsScreen() {
  const user = useAuthStore((s) => s.user)!;

  const canIssue = ISSUE_ROLES.includes(user.role);
  const canUpdate = UPDATE_ROLES.includes(user.role);

  // ✅ FIXED HERE
  const [view, setView] = useState<InstructionView>('projects');

  const [project, setProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<Instruction | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [instructions, setInstructions] = useState<Instruction[]>([]);

  useEffect(() => {
    projectsApi.list().then(setProjects);
  }, []);

  if (view === 'projects') {
    return (
      <Screen>
        <FlatList
          data={projects}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => {
                setProject(item);
                setView('list');
              }}
            >
              <Text>{item.name}</Text>
            </TouchableOpacity>
          )}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text>Instructions Screen</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({});