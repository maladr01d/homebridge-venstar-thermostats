const venstarAPI = require('./api.js')

class VenstarThermostatsPlatformAccessory {
	constructor(platform, accessory, uri) {
		this.platform = platform;
		this.accessory = accessory;
		this.uri = uri;
		// set accessory information
		this.accessory
            .getService(this.platform.Service.AccessoryInformation)
            .setCharacteristic(this.platform.Characteristic.Manufacturer, "Venstar")
            .setCharacteristic(this.platform.Characteristic.Model, "T2000")
            .setCharacteristic(this.platform.Characteristic.SerialNumber, "UNO");
        this.API = new venstarAPI.VenstarAPI(this.uri);
        this.State = new venstarAPI.GetInfoResponse();
        
        this.service =
            this.accessory.getService(this.platform.Service.Thermostat) ||
                this.accessory.addService(this.platform.Service.Thermostat);
        this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

       
        this.service
            .getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
            .onGet(this.handleCurrentHeatingCoolingStateGet.bind(this));
        this.service
            .getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
            .setProps({
                validValues: [0, 1, 2, 3] // Off, Heat, Cool, Auto
            })
            .onGet(this.handleTargetHeatingCoolingStateGet.bind(this))
            .onSet(this.handleTargetHeatingCoolingStateSet.bind(this));
        this.service
            .getCharacteristic(this.platform.Characteristic.CurrentTemperature)
            .onGet(this.handleCurrentTemperatureGet.bind(this));
        this.service
            .getCharacteristic(this.platform.Characteristic.TargetTemperature)
            .onGet(this.handleTargetTemperatureGet.bind(this))
            .onSet(this.handleTargetTemperatureSet.bind(this));
        this.service
            .getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
            .onGet(this.handleCoolingTemperatureGet.bind(this))
            .onSet(this.handleCoolingTemperatureSet.bind(this));
        this.service
            .getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
            .onGet(this.handleHeatingTemperatureGet.bind(this))
            .onSet(this.handleHeatingTemperatureSet.bind(this));
        this.service
            .getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
            .onGet(this.handleTemperatureDisplayUnitsGet.bind(this));
        // Fan Service
        const fanService = this.accessory.getService("Fan") ||
            this.accessory.addService(this.platform.Service.Fanv2, "Fan", "YourUniqueIdentifier-2");
        // create handlers for required characteristics
        fanService
            .getCharacteristic(this.platform.Characteristic.Active)
            .onGet(this.handleFanActiveGet.bind(this))
            .onSet(this.handleFanActiveSet.bind(this));

        // Initial state fetch and set temperature ranges
        this.pullState().then(() => {
            this.updateTemperatureRanges();
        });

         // Poll thermostat every 30 seconds to keep state fresh
        this.pollInterval = setInterval(() => {
            this.updateAllCharacteristics();
        }, 30000); // 30 seconds
            
    }
    
    async handleFanActiveGet() {
        return this.State.fanstate;
    }
    async handleFanActiveSet(value) {
        const fanValue = value ? 1 : 0;
        this.API.setControl("fan=" + fanValue);
        
        // Immediately refresh state from thermostat
        await this.updateAllCharacteristics();
    }
    async handleCurrentHeatingCoolingStateGet() {
        return this.toCurrentHeatingCoolingState(this.State.state);
    }
    // Venstar state: 0 = idle, 1 = heating, 2 = cooling, 3 = lockout, 4 = error.
    // HomeKit only accepts 0 = OFF, 1 = HEAT, 2 = COOL, so lockout/error report as OFF.
    toCurrentHeatingCoolingState(venstarState) {
        const { OFF, HEAT, COOL } = this.platform.Characteristic.CurrentHeatingCoolingState;
        switch (venstarState) {
            case 1:
                return HEAT;
            case 2:
                return COOL;
            default:
                return OFF;
        }
    }
    async handleTargetHeatingCoolingStateGet() {
        return this.State.mode;
    }
    async handleTargetHeatingCoolingStateSet(value) {
        const state = await this.API.getInfo();
    
        if (value == 3) {
            // Switching TO Auto mode - must send both heattemp and cooltemp
            // Ensure they respect the setpointdelta
            const deltaInCelsius = this.State.tempunits == 0 
                ? this.ftoc(state.setpointdelta) 
                : state.setpointdelta;
            
            let heatValue = state.heattemp;
            let coolValue = state.cooltemp;
            
            // Ensure cooltemp > heattemp by at least setpointdelta
            if (coolValue <= heatValue + deltaInCelsius) {
                // Adjust to maintain proper delta
                const midpoint = (heatValue + coolValue) / 2;
                heatValue = midpoint - deltaInCelsius / 2;
                coolValue = midpoint + deltaInCelsius / 2;
            }
            
            const convertedHeat = heatValue.toFixed(2).toString();
            const convertedCool = coolValue.toFixed(2).toString();
            
            await this.API.setControl(`mode=3&heattemp=${convertedHeat}&cooltemp=${convertedCool}`);
        } else {
            // Switching to Off, Heat, or Cool
            await this.API.setControl("mode=" + value);
        }
        
        // Immediately refresh state from thermostat
        await this.updateAllCharacteristics();
    }
    async handleCurrentTemperatureGet() {
        return this.State.spacetemp;
    }
    async handleTargetTemperatureGet() {
        switch (this.State.mode) {
            case 3: // Auto - return midpoint (HomeKit still queries this)
                return (this.State.heattemp + this.State.cooltemp) / 2;
            case 2: // Cool
                return this.State.cooltemp;
            case 1: // Heat
                return this.State.heattemp;
            case 0: // Off
            default:
                return (this.State.heattemp + this.State.cooltemp) / 2;
        }
    }
    async handleTargetTemperatureSet(value) {
        const state = await this.API.getInfo();
    
        if (state.mode == 3) {
            // Auto mode - this shouldn't normally be called in Auto mode
            // as HomeKit uses HeatingThreshold and CoolingThreshold instead
            // But if it is called, we adjust both maintaining the setpointdelta
            const deltaInCelsius = this.State.tempunits == 0 
                ? this.ftoc(state.setpointdelta) 
                : state.setpointdelta;
            
            const heatValue = (value - deltaInCelsius / 2);
            const coolValue = (value + deltaInCelsius / 2);
            
            const convertedHeat = this.convertTemp(heatValue).toFixed(2).toString();
            const convertedCool = this.convertTemp(coolValue).toFixed(2).toString();
            
            await this.API.setControl(`heattemp=${convertedHeat}&cooltemp=${convertedCool}`);
        } else if (state.mode == 2) {
            // Cool mode
            const convertedValue = this.convertTemp(value).toFixed(2).toString();
            await this.API.setControl("cooltemp=" + convertedValue);
        } else if (state.mode == 1) {
            // Heat mode
            const convertedValue = this.convertTemp(value).toFixed(2).toString();
            await this.API.setControl("heattemp=" + convertedValue);
        }
        
        // Immediately refresh state from thermostat
        await this.updateAllCharacteristics();
    }
    async handleCoolingTemperatureGet() {
        return this.State.cooltemp;
    }
    async handleCoolingTemperatureSet(value) {
        const convertedValue = this.convertTemp(value).toFixed(2).toString();
        await this.API.setControl("cooltemp=" + convertedValue);
        
        // Immediately refresh state from thermostat
        await this.updateAllCharacteristics();

    }
    async handleHeatingTemperatureGet() {
        return this.State.heattemp;
    }
    async handleHeatingTemperatureSet(value) {
        const convertedValue = this.convertTemp(value).toFixed(2).toString();
        await this.API.setControl("heattemp=" + convertedValue);
        
        // Immediately refresh state from thermostat
        await this.updateAllCharacteristics();

    }
    async handleTemperatureDisplayUnitsGet() {
        return this.State.tempunits == 0
            ? this.platform.Characteristic.TemperatureDisplayUnits.FAHRENHEIT
            : this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;
    }
    
    async pullState() {
        return this.API.getInfo()
            .then((res) => {
                this.platform.log.debug(`Thermostat state - mode: ${res.mode}, state: ${res.state}, spacetemp: ${res.spacetemp}`);
                this.State = res;
                this.convertTemps();
                // Update ranges in case they changed (rare, but possible)
                this.updateTemperatureRanges();
                return res;
            })
            .catch((err) => {
                throw err;
            });
    }

    async updateAllCharacteristics() {
        try {
            const state = await this.pullState();
            
            // Update all characteristics with fresh values
            this.service.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
                .updateValue(this.toCurrentHeatingCoolingState(state.state));
            
            this.service.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
                .updateValue(state.mode);
            
            this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
                .updateValue(state.spacetemp);
            
            // Update target temperature based on current mode
            let targetTemp;
            switch (state.mode) {
                case 2:
                    targetTemp = state.cooltemp;
                    break;
                case 1:
                    targetTemp = state.heattemp;
                    break;
                default:
                    targetTemp = (state.heattemp + state.cooltemp) / 2;
                    break;
            }
            this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
                .updateValue(targetTemp);
            
            this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
                .updateValue(state.cooltemp);
            
            this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
                .updateValue(state.heattemp);
            
            // Update fan state
            const fanService = this.accessory.getService("Fan");
            if (fanService) {
                fanService.getCharacteristic(this.platform.Characteristic.Active)
                    .updateValue(state.fanstate);
            }
            
        } catch (error) {
            this.platform.log.error('Error updating characteristics:', error);
        }
    }

    updateTemperatureRanges() {
        // HomeKit expects Celsius, and we've already converted in pullState()
        const minTemp = Math.min(this.State.heattempmin, this.State.cooltempmin);
        const maxTemp = Math.max(this.State.heattempmax, this.State.cooltempmax);
        
        this.platform.log.debug(
            `Setting temperature ranges: ${minTemp}°C - ${maxTemp}°C`
        );
        
        // Set overall temperature range
        this.service
            .getCharacteristic(this.platform.Characteristic.TargetTemperature)
            .setProps({
                minValue: minTemp,
                maxValue: maxTemp,
                minStep: 0.5
            });
        
        // Set cooling threshold range
        this.service
            .getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
            .setProps({
                minValue: this.State.cooltempmin,
                maxValue: this.State.cooltempmax,
                minStep: 0.5
            });
        
        // Set heating threshold range
        this.service
            .getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
            .setProps({
                minValue: this.State.heattempmin,
                maxValue: this.State.heattempmax,
                minStep: 0.5
            });
    }

    ftoc = function(temperature) {
  		return (temperature - 32) / 1.8;
	};
	ctof = function(temperature) {
  		return (temperature * 1.8) + 32;
	};
	usesFahrenheit = function() {
  		return this.State.tempunits === 0 ? true : false;
  	};
  	convertTemp = function(temperature) {
  		if (this.usesFahrenheit() == true) {
  			return this.ctof(temperature);
  		}
  		return temperature;
  	}
  	convertTemps = function() {
  		if (this.usesFahrenheit()) {
  			this.State.spacetemp = this.ftoc(this.State.spacetemp);
  			this.State.heattemp = this.ftoc(this.State.heattemp);
  			this.State.cooltemp = this.ftoc(this.State.cooltemp);
  			this.State.cooltempmin = this.ftoc(this.State.cooltempmin);
  			this.State.cooltempmax = this.ftoc(this.State.cooltempmax);
  			this.State.heattempmin = this.ftoc(this.State.heattempmin);
  			this.State.heattempmax = this.ftoc(this.State.heattempmax);
  		}
  	}

    destroy() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }   
    }
    
}

exports.VenstarThermostatsPlatformAccessory = VenstarThermostatsPlatformAccessory;