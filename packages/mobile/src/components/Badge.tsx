import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export type BadgeVariant =
  | 'default'
  | 'success'
  | 'warning'
  | 'error'
  | 'destructive'
  | 'outline';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
}

export function Badge({ label, variant = 'default' }: BadgeProps) {
  const badgeStyle =
    variant === 'success'
      ? styles.success
      : variant === 'warning'
        ? styles.warning
        : variant === 'error' || variant === 'destructive'
          ? styles.error
          : variant === 'outline'
            ? styles.outline
            : styles.default;

  const textStyle = variant === 'outline' ? styles.outlineText : styles.text;

  return (
    <View style={[styles.badge, badgeStyle]}>
      <Text style={textStyle}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  text: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
  },
  default: {
    backgroundColor: '#334155',
  },
  success: {
    backgroundColor: '#16a34a',
  },
  warning: {
    backgroundColor: '#f59e0b',
  },
  error: {
    backgroundColor: '#dc2626',
  },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: '#64748b',
  },
  outlineText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
  },
});