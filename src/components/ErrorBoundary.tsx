/**
 * 1stOne F1 — ErrorBoundary
 *
 * Catches unhandled JS errors in the component tree.
 * Shows a recovery UI instead of a white crash screen.
 * Logs error info for debugging.
 */

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Theme } from '../theme';
import { ThemedText } from './ThemedText';
import { captureError } from '../utils/sentry';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error.message);
    console.error('[ErrorBoundary] Component stack:', info.componentStack);
    captureError(error, { componentStack: info.componentStack ?? '' });
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container}>
          <ThemedText variant="header" color="primary" style={styles.title}>
            Something went wrong
          </ThemedText>
          <ThemedText variant="body" color="subtitle" style={styles.message}>
            The app encountered an unexpected error. This has been logged and we'll look into it.
          </ThemedText>
          {__DEV__ && this.state.error && (
            <View style={styles.debugBox}>
              <ThemedText variant="small" color="muted">
                {this.state.error.message}
              </ThemedText>
            </View>
          )}
          <TouchableOpacity style={styles.retryBtn} onPress={this.handleRetry}>
            <ThemedText variant="subtitle" color="primary">
              Try Again
            </ThemedText>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Theme.colors.background.primary,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Theme.spacing.lg,
  },
  title: {
    marginBottom: Theme.spacing.md,
  },
  message: {
    textAlign: 'center',
    marginBottom: Theme.spacing.lg,
  },
  debugBox: {
    backgroundColor: Theme.colors.background.secondary,
    borderRadius: Theme.components.inputRadius,
    padding: Theme.spacing.md,
    marginBottom: Theme.spacing.lg,
    maxWidth: '100%',
  },
  retryBtn: {
    backgroundColor: Theme.colors.action.primary,
    paddingHorizontal: Theme.spacing.xl,
    paddingVertical: Theme.spacing.md,
    borderRadius: Theme.components.inputRadius,
  },
});
