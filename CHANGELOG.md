# Changelog
All notable changes to the Homebridge Venstar Thermostat Plugin will be documented here.

## [1.0.2] - 2026-09-25

### Bug Fixes
- Fixed a fatal "TypeError: fetch failed" crash when a thermostat can't be reached on startup. The plugin now logs the error and retries on the next poll.
- Improved connection error logging to include the thermostat address and the underlying network cause.

## [1.0.1] - 2026-09-25

### Bug Fixes
- Fixed a crash on Homebridge shutdown/restart ("Cannot read properties of undefined (reading 'forEach')") and ensured thermostat polling is stopped on shutdown.
- Fixed the Current Heating Cooling State warning when the thermostat reports lockout or error states.
- Fixed a startup error when no thermostats are defined in the config.

## [1.0.0] - 2025-11-27

### Feature Additions
- Added support for Auto mode

### Bug Fixes
- Fixed a bug related to temperature thresholds

## [0.9.6] - 2025-11-22

### Bug and Performance Fixes
- Fixed a delay between controlling the thermostat accessory and the interface being updated.

## [0.9.5] - 2025-11-22

### Bug and Performance Fixes
- Changed the way data is handled so that the homekit accessory more accurately reflects the current thermostat state.
- Fixed a warning about the plugin slowing down homebridge by polling the thermostat every 30 seconds and caching data.

## [0.9.4] - 2024-08-21

### Bug Fixes
- Fix Current Heating Cooling State Warning bug.

## [0.9.3] - 2022-07-31

### Bug Fixes
- Fix Target Temperature error when changing mode.
