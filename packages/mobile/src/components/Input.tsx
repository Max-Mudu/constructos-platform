import React from 'react';
import {
  View, Text, TextInput, StyleSheet, TextInputProps, ViewStyle,
} from 'react-native';

interface InputProps extends TextInputProps {
  label?:      string;
  error?:      string;
  containerStyle?: ViewStyle;
}

export function Input({ label, error, containerStyle, ...props }: InputProps) {
  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        style={[styles.input, error ? styles.inputError : null, props.style as object]}
        placeholderTextColor="#475569"
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label:     { color: '#94a3b8', fontSize: 13, fontWeight: '500', marginBottom: 6 },
  input: {
    backgroundColor: '#1e293b',
    borderWidth:     1,
    borderColor:     '#334155',
    borderRadius:    8,
    height:          48,
    paddingHorizontal: 14,
    color:           '#f1f5f9',
    fontSize:        15,
  },
  inputError: { borderColor: '#ef4444' },
  error:      { color: '#ef4444', fontSize: 12, marginTop: 4 },
});
