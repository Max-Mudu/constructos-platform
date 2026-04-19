import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

type BadgeVariant = 'success' | 'warning' | 'destructive' | 'default' | 'outline';

interface BadgeProps {
  label:    string;
  variant?: BadgeVariant;
}

export function Badge({ label, variant = 'default' }: BadgeProps) {
  return (
    <View style={[styles.badge, styles[variant]]}>
      <Text style={[styles.text, styles[`${variant}Text` as keyof typeof styles]]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      99,
    alignSelf:         'flex-start',
  },
  text: { fontSize: 12, fontWeight: '600' },

  default:       { backgroundColor: '#334155' },
  defaultText:   { color: '#f1f5f9' },
  success:       { backgroundColor: '#14532d' },
  successText:   { color: '#22c55e' },
  warning:       { backgroundColor: '#451a03' },
  warningText:   { color: '#f59e0b' },
  destructive:   { backgroundColor: '#450a0a' },
  destructiveText: { color: '#ef4444' },
  outline:       { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#334155' },
  outlineText:   { color: '#94a3b8' },
});
