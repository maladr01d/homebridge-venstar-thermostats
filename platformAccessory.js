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

        // set up
        this.pullState();

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
        this.State.fanstate = fanValue; // Update cache 
    }
    async handleCurrentHeatingCoolingStateGet() {
        return this.State.state;
    }
    async handleTargetHeatingCoolingStateGet() {
        return this.State.mode;
    }
    async handleTargetHeatingCoolingStateSet(value) {
        await this.API.setControl("mode=" + value);
        this.State.mode = value; // Update cache
        
        // Update target temperature based on new mode
        let targetTemp;
        switch (value) {
            case 2:
                targetTemp = this.State.cooltemp;
                break;
            case 1:
                targetTemp = this.State.heattemp;
                break;
            default:
                targetTemp = (this.State.heattemp + this.State.cooltemp) / 2;
                break;
        }
        this.service.getCharacteristic(this.platform.Characteristic.TargetTemperature)
            .updateValue(targetTemp);
    }
    async handleCurrentTemperatureGet() {
        return this.State.spacetemp;
    }
    async handleTargetTemperatureGet() {
        switch (this.State.mode) {
            case 2:
                return this.State.cooltemp;
            case 1:
                return this.State.heattemp;
            default:
                return (this.State.heattemp + this.State.cooltemp) / 2;
        }
    }
    async handleTargetTemperatureSet(value) {
        const test = await this.API.getInfo();
        const tempMode = test.mode == 2 ? "cooltemp" : "heattemp";
        const convertedValue = this.convertTemp(value).toFixed(2).toString();
        await this.API.setControl(tempMode + "=" + convertedValue);
        
        // Update cache with converted value
        const celsiusValue = this.State.tempunits == 0 ? this.ftoc(parseFloat(convertedValue)) : parseFloat(convertedValue);
        if (test.mode == 2) {
            this.State.cooltemp = celsiusValue;
        } else {
            this.State.heattemp = celsiusValue;
        }
    }
    async handleCoolingTemperatureGet() {
        return this.State.cooltemp;
    }
    async handleCoolingTemperatureSet(value) {
        const convertedValue = this.convertTemp(value).toFixed(2).toString();
        await this.API.setControl("cooltemp=" + convertedValue);
        this.State.cooltemp = value; // Update cache (already in Celsius)

    }
    async handleHeatingTemperatureGet() {
        return this.State.heattemp;
    }
    async handleHeatingTemperatureSet(value) {
        const convertedValue = this.convertTemp(value).toFixed(2).toString();
        await this.API.setControl("heattemp=" + convertedValue);
        this.State.cooltemp = value; // Update cache (already in Celsius)

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
                .updateValue(state.state);
            
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