import React from 'react';
import { View, ScrollView, StyleSheet, ViewStyle, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface ScreenProps {
  children:       React.ReactNode;
  scroll?:        boolean;
  style?:         ViewStyle;
  contentStyle?:  ViewStyle;
  refreshing?:    boolean;
  onRefresh?:     () => void;
}

export function Screen({ children, scroll = false, style, contentStyle, refreshing, onRefresh }: ScreenProps) {
  const content = scroll ? (
    <ScrollView
      style={[styles.scroll, style]}
      contentContainerStyle={[styles.content, contentStyle]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh != null ? (
          <RefreshControl
            refreshing={refreshing ?? false}
            onRefresh={onRefresh}
            tintColor="#3b82f6"
            colors={['#3b82f6']}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.fill, style, contentStyle]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: '#0f172a' },
  scroll:  { flex: 1, backgroundColor: '#0f172a' },
  fill:    { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 32 },
});
