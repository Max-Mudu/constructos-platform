import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface EmptyStateProps {
  title:       string;
  description?: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    padding:        32,
    minHeight:      160,
  },
  title:       { color: '#f1f5f9', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  description: { color: '#94a3b8', fontSize: 14, textAlign: 'center', marginTop: 8 },
});
