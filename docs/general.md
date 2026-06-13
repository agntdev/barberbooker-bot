# Barbershop Booking Assistant Bot - GENERAL Design Document

## Summary
This Telegram bot enables customers to book, manage, cancel, and reschedule appointments at a barbershop using predefined time slots. It provides a streamlined interface for selecting services, optional barbers, and available times, while automatically notifying the barbershop owner of all booking-related activities via Telegram messages. The bot is designed for simplicity, focusing solely on appointment management without real-time scheduling updates or payment processing.

## Core Entities
- **User**: Telegram customer with basic profile (ID, name)
- **Service**: Barbershop service (ID, name, description, duration)
- **Barber**: Barber profile (ID, name, specialty)
- **TimeSlot**: Predefined availability (ID, date, time, associated service, barber)
- **Appointment**: Customer booking (ID, user ID, service ID, barber ID, time slot ID, status)
- **Notification**: Owner alerts (ID, type [booking/cancel/reschedule], appointment ID, timestamp)

Relationships:
- User → Appointment (1:N)
- Service → Appointment (1:N)
- Barber → Appointment (1:N)
- TimeSlot → Appointment (1:1)
- Appointment → Notification (1:N)

## External Dependencies
- **Telegram Bot API**: 
  - Inline keyboards for service/barber/time selection
  - Message notifications to owner
  - User authentication via Telegram ID
- **Database**: 
  - Store services, barbers, time slots, appointments, and notifications
  - Required fields: 
    - Services: name, description, duration
    - Barbers: name, specialty
    - TimeSlots: date, time, service ID, barber ID
    - Appointments: user ID, service ID, barber ID, time slot ID, status
    - Notifications: type, appointment ID, timestamp

## Feature List
- **Service Selection**
  - Display list of available services with descriptions and durations
  - Allow users to select a service for booking
- **Barber Selection (Optional)**
  - Show list of barbers with specialties
  - Permit users to choose a preferred barber or skip selection
- **Date Selection**
  - Present calendar-style interface for choosing appointment dates
- **Time Slot Selection**
  - List predefined time slots for selected date/service
  - Validate slot availability based on barber assignments
- **Appointment Confirmation**
  - Send confirmation message with appointment details
  - Store appointment in database
- **Appointment Management**
  - Display upcoming appointments with details
  - Allow filtering by date/status
- **Direct Cancellation**
  - Process cancellations instantly with confirmation
  - Update appointment status to "cancelled"
- **Direct Rescheduling**
  - Let users select a new date/time for existing appointments
  - Update appointment records with new details
- **Owner Notifications**
  - Send Telegram message for each new booking
  - Send Telegram message for each cancellation/reschedule
  - Include appointment details in notifications
- **Data Persistence**
  - Maintain permanent records of all services, barbers, and time slots
  - Archive completed/cancelled appointments with timestamps

## Non-Goals
- Real-time availability tracking of time slots
- Payment processing or financial transaction handling
- Advanced customer management features (loyalty programs, history tracking)
- Multi-location support or franchise management
- Voice message or video call integration
- Dynamic time slot generation based on barber workload