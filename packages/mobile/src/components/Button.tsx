import React from 'react';
import {
  TouchableOpacity, Text, ActivityIndicator, StyleSheet, ViewStyle, TextStyle,
} from 'react-native';

interface ButtonProps {
  title:      string;
  onPress:    () => void;
  variant?:   'primary' | 'secondary' | 'destructive' | 'ghost';
  loading?:   boolean;
  disabled?:  boolean;
  style?:     ViewStyle;
  textStyle?: TextStyle;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  textStyle,
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      style={[styles.base, styles[variant], isDisabled && styles.disabled, style]}
      activeOpacity={0.75}
    >
      {loading ? (
        <ActivityIndicator
          color={variant === 'primary' ? '#ffffff' : '#3b82f6'}
          size="small"
        />
      ) : (
        <Text style={[styles.text, styles[`${variant}Text` as keyof typeof styles], textStyle]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    height:         48,
    borderRadius:   10,
    alignItems:     'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  primary:     { backgroundColor: '#3b82f6' },
  secondary:   { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  destructive: { backgroundColor: '#ef4444' },
  ghost:       { backgroundColor: 'transparent' },
  disabled:    { opacity: 0.5 },

  text:            { fontSize: 15, fontWeight: '600' },
  primaryText:     { color: '#ffffff' },
  secondaryText:   { color: '#f1f5f9' },
  destructiveText: { color: '#ffffff' },
  ghostText:       { color: '#3b82f6' },
});
