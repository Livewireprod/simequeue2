import socket
import time
from pythonosc import dispatcher
from pythonosc import osc_server
import threading


class ColorlightZ8:
    def __init__(self, ip_address, port=9099):
        """
        Initialize Colorlight Z8 controller

        Args:
            ip_address: IP address of the Z8 device
            port: UDP port (default 9099)
        """
        self.ip_address = ip_address
        self.port = port
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    def send_command(self, command):
        """Send a command via UDP"""
        self.sock.sendto(command, (self.ip_address, self.port))
        print(f"Sent: {' '.join(f'{b:02x}' for b in command)}")

    def switch_preset(self, preset_number, select_all=False):
        """
        Switch to a specific preset (1-16)

        Args:
            preset_number: Preset number (1-16)
            select_all: If True, use FF FF (all senders), else 00 00
        """
        if not 1 <= preset_number <= 16:
            raise ValueError("Preset number must be between 1 and 16")

        preset_value = preset_number - 1
        sender_hi = 0xFF if select_all else 0x00
        sender_lo = 0xFF if select_all else 0x00

        command = bytes([
            0x02, 0x10, 0x00, 0x13, 0x00, 0x00, 0x00,
            sender_hi, sender_lo,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            preset_value, 0x00,
        ])

        self.send_command(command)
        print(f"Switched to preset {preset_number}")

    def set_blackout(self, enabled, select_all=False):
        """
        Enable or disable blackout

        Args:
            enabled: True to enable blackout, False to disable
            select_all: If True, use FF FF (all senders), else 00 00
        """
        sender_hi = 0xFF if select_all else 0x00
        sender_lo = 0xFF if select_all else 0x00
        blackout_value = 0x01 if enabled else 0x00

        command = bytes([
            0x10, 0x10, 0x00, 0x12, 0x00, 0x00, 0x00,
            sender_hi, sender_lo,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            blackout_value,
        ])

        self.send_command(command)
        state = "enabled" if enabled else "disabled"
        print(f"Blackout {state}")

    def set_brightness(self, brightness_percent, select_all=False):
        """
        Set brightness (0-100%)

        Args:
            brightness_percent: Brightness value (0-100)
            select_all: If True, use FF FF (all senders), else 00 00
        """
        if not 0 <= brightness_percent <= 100:
            raise ValueError("Brightness must be between 0 and 100")

        sender_hi = 0xFF if select_all else 0x00
        sender_lo = 0xFF if select_all else 0x00

        # Convert percentage to value (0-10000)
        brightness_value = int(brightness_percent * 100)

        # Little-endian 16-bit value
        brightness_lo = brightness_value & 0xFF
        brightness_hi = (brightness_value >> 8) & 0xFF

        command = bytes([
            0x50, 0x10, 0x00, 0x13, 0x00, 0x00, 0x00,
            sender_hi, sender_lo,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            brightness_lo, brightness_hi,
        ])

        self.send_command(command)
        print(f"Set brightness to {brightness_percent}%")

    def close(self):
        """Close the UDP socket"""
        self.sock.close()


class OSCPresetListener:
    def __init__(self, controller, allowed_ip, osc_port=8000):
        """
        OSC listener for controlling Colorlight Z8

        Args:
            controller: ColorlightZ8 instance
            allowed_ip: IP address allowed to send commands
            osc_port: Port to listen for OSC messages
        """
        self.controller = controller
        self.allowed_ip = allowed_ip
        self.osc_port = osc_port
        self.server = None
        self.server_thread = None

    def preset_handler(self, address, *args):
        """Handle incoming OSC messages for preset switching"""
        client_address = getattr(self.server, '_last_client_address', None)
        
        if client_address and client_address[0] != self.allowed_ip:
            print(f"Rejected command from {client_address[0]}")
            return

        if len(args) > 0:
            preset_number = int(args[0])
            print(f"Received OSC: {address} -> preset {preset_number}")
            try:
                self.controller.switch_preset(preset_number, select_all=True)
            except ValueError as e:
                print(f"Error: {e}")
        else:
            print(f"No preset number provided")

    def blackout_handler(self, address, *args):
        """Handle incoming OSC messages for blackout"""
        client_address = getattr(self.server, '_last_client_address', None)
        
        if client_address and client_address[0] != self.allowed_ip:
            print(f"Rejected command from {client_address[0]}")
            return

        if len(args) > 0:
            # Accept 1/0, True/False, or any non-zero value
            enabled = bool(args[0]) if isinstance(args[0], (int, float)) \
                      else args[0]
            print(f"Received OSC: {address} -> blackout {enabled}")
            self.controller.set_blackout(enabled, select_all=True)
        else:
            print(f"No blackout value provided")

    def brightness_handler(self, address, *args):
        """Handle incoming OSC messages for brightness"""
        client_address = getattr(self.server, '_last_client_address', None)
        
        if client_address and client_address[0] != self.allowed_ip:
            print(f"Rejected command from {client_address[0]}")
            return

        if len(args) > 0:
            brightness = float(args[0])
            # Support 0-1 range (normalize to 0-100)
            if 0 <= brightness <= 1:
                brightness = brightness * 100
            print(f"Received OSC: {address} -> brightness {brightness}%")
            try:
                self.controller.set_brightness(brightness, select_all=True)
            except ValueError as e:
                print(f"Error: {e}")
        else:
            print(f"No brightness value provided")

    def start(self):
        """Start the OSC server"""
        disp = dispatcher.Dispatcher()
        disp.map("/preset", self.preset_handler)
        disp.map("/blackout", self.blackout_handler)
        disp.map("/brightness", self.brightness_handler)

        # Create custom server class to capture client address
        class CustomOSCUDPServer(osc_server.ThreadingOSCUDPServer):
            def verify_request(self, request, client_address):
                self._last_client_address = client_address
                return True

        self.server = CustomOSCUDPServer(
            ("0.0.0.0", self.osc_port), disp
        )
        
        print(f"\nOSC Server listening on port {self.osc_port}")
        print(f"Accepting commands from: {self.allowed_ip}")
        print("\nAvailable OSC addresses:")
        print("  /preset <1-16>       - Switch to preset")
        print("  /blackout <0/1>      - Disable/Enable blackout")
        print("  /brightness <0-100>  - Set brightness (also accepts 0-1)")
        print("\nPress Ctrl+C to stop\n")

        self.server_thread = threading.Thread(
            target=self.server.serve_forever
        )
        self.server_thread.daemon = True
        self.server_thread.start()

    def stop(self):
        """Stop the OSC server"""
        if self.server:
            self.server.shutdown()


if __name__ == "__main__":
    # Configuration
    Z8_IP = "192.168.20.192"
    Z8_PORT = 9099
    OSC_PORT = 8000

    # Get allowed IP from user
    print("=== Colorlight Z8 OSC Controller ===\n")
    allowed_ip = input(
        "Enter the IP address allowed to send OSC commands: "
    ).strip()
    
    if not allowed_ip:
        print("No IP address provided. Exiting.")
        exit(1)

    # Initialize controller
    controller = ColorlightZ8(Z8_IP, Z8_PORT)

    # Initialize OSC listener
    listener = OSCPresetListener(controller, allowed_ip, OSC_PORT)

    try:
        listener.start()
        
        # Keep the script running
        while True:
            time.sleep(1)

    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        listener.stop()
        controller.close()
        print("Shutdown complete")
