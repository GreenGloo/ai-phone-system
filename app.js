import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Phone, User, MapPin, DollarSign, Bell, Plus, Edit, Trash2, CheckCircle } from 'lucide-react';

const CalendarApp = () => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [appointments, setAppointments] = useState([
    {
      id: 1,
      customerName: "John Smith",
      customerPhone: "(555) 123-4567",
      service: "Emergency Repair",
      issue: "Burst pipe in basement",
      date: new Date(2025, 5, 10, 9, 0),
      duration: 60,
      status: "confirmed",
      bookedVia: "AI Phone",
      estimatedRevenue: 150,
      address: "123 Main St"
    },
    {
      id: 2,
      customerName: "Sarah Johnson",
      customerPhone: "(555) 987-6543", 
      service: "Kitchen Sink Installation",
      issue: "Install new kitchen sink",
      date: new Date(2025, 5, 10, 14, 0),
      duration: 120,
      status: "confirmed",
      bookedVia: "AI Phone",
      estimatedRevenue: 200,
      address: "456 Oak Ave"
    },
    {
      id: 3,
      customerName: "Mike Davis",
      customerPhone: "(555) 555-1234",
      service: "Water Heater Repair", 
      issue: "No hot water",
      date: new Date(2025, 5, 11, 10, 30),
      duration: 90,
      status: "pending",
      bookedVia: "AI Phone",
      estimatedRevenue: 175,
      address: "789 Pine St"
    }
  ]);

  const [showNewAppointment, setShowNewAppointment] = useState(false);
  const [notifications, setNotifications] = useState([
    {
      id: 1,
      type: "new_booking",
      message: "New emergency appointment booked for 9:00 AM",
      time: "2 minutes ago",
      read: false
    },
    {
      id: 2,
      type: "upcoming",
      message: "Appointment with John Smith in 30 minutes",
      time: "30 minutes",
      read: false
    }
  ]);

  // Get appointments for selected date
  const getDayAppointments = (date) => {
    return appointments.filter(apt => {
      const aptDate = new Date(apt.date);
      return aptDate.toDateString() === date.toDateString();
    }).sort((a, b) => new Date(a.date) - new Date(b.date));
  };

  // Generate calendar days
  const generateCalendarDays = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - firstDay.getDay());

    const days = [];
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + 42);

    for (let date = new Date(startDate); date < endDate; date.setDate(date.getDate() + 1)) {
      const dayAppointments = getDayAppointments(date);
      days.push({
        date: new Date(date),
        isCurrentMonth: date.getMonth() === month,
        isToday: date.toDateString() === new Date().toDateString(),
        isSelected: date.toDateString() === selectedDate.toDateString(),
        appointmentCount: dayAppointments.length,
        revenue: dayAppointments.reduce((sum, apt) => sum + apt.estimatedRevenue, 0)
      });
    }

    return days;
  };

  // Add new appointment (simulates AI booking)
  const addAppointment = (appointmentData) => {
    const newAppointment = {
      id: Date.now(),
      ...appointmentData,
      status: "confirmed",
      bookedVia: "AI Phone"
    };
    setAppointments([...appointments, newAppointment]);
    
    // Add notification
    setNotifications([{
      id: Date.now(),
      type: "new_booking",
      message: `New appointment booked: ${appointmentData.customerName}`,
      time: "Just now",
      read: false
    }, ...notifications]);
  };

  // Get available time slots for a date
  const getAvailableSlots = (date) => {
    const dayAppointments = getDayAppointments(date);
    const businessHours = { start: 8, end: 18 }; // 8 AM to 6 PM
    const slots = [];

    for (let hour = businessHours.start; hour < businessHours.end; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const slotTime = new Date(date);
        slotTime.setHours(hour, minute, 0, 0);
        
        const slotEnd = new Date(slotTime);
        slotEnd.setMinutes(slotEnd.getMinutes() + 60);

        // Check if slot conflicts with existing appointments
        const hasConflict = dayAppointments.some(apt => {
          const aptStart = new Date(apt.date);
          const aptEnd = new Date(aptStart.getTime() + apt.duration * 60000);
          return (slotTime < aptEnd && slotEnd > aptStart);
        });

        if (!hasConflict) {
          slots.push({
            time: slotTime,
            display: slotTime.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            })
          });
        }
      }
    }

    return slots.slice(0, 8); // Return first 8 available slots
  };

  const todayAppointments = getDayAppointments(selectedDate);
  const availableSlots = getAvailableSlots(selectedDate);
  const calendarDays = generateCalendarDays();

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">CallCatcher Calendar</h1>
              <p className="text-gray-600">AI-powered appointment scheduling</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="relative">
                <Bell className="w-6 h-6 text-gray-600 cursor-pointer" />
                {notifications.filter(n => !n.read).length > 0 && (
                  <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                    {notifications.filter(n => !n.read).length}
                  </span>
                )}
              </div>
              <button 
                onClick={() => setShowNewAppointment(true)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Manual Booking
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-gray-900">
                  {currentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </h2>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() - 1)))}
                    className="px-3 py-1 border rounded hover:bg-gray-50"
                  >
                    ←
                  </button>
                  <button 
                    onClick={() => setCurrentDate(new Date())}
                    className="px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                  >
                    Today
                  </button>
                  <button 
                    onClick={() => setCurrentDate(new Date(currentDate.setMonth(currentDate.getMonth() + 1)))}
                    className="px-3 py-1 border rounded hover:bg-gray-50"
                  >
                    →
                  </button>
                </div>
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                  <div key={day} className="p-2 text-center text-sm font-medium text-gray-500">
                    {day}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, index) => (
                  <div
                    key={index}
                    onClick={() => setSelectedDate(day.date)}
                    className={`
                      p-2 min-h-[60px] border rounded cursor-pointer hover:bg-blue-50
                      ${day.isCurrentMonth ? 'bg-white' : 'bg-gray-50 text-gray-400'}
                      ${day.isToday ? 'ring-2 ring-blue-500' : ''}
                      ${day.isSelected ? 'bg-blue-100' : ''}
                    `}
                  >
                    <div className="text-sm font-medium">{day.date.getDate()}</div>
                    {day.appointmentCount > 0 && (
                      <div className="text-xs mt-1">
                        <div className="bg-green-100 text-green-700 px-1 rounded text-center">
                          {day.appointmentCount} apt
                        </div>
                        <div className="text-green-600 font-medium">
                          ${day.revenue}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Sidebar */}
          <div className="space-y-6">
            {/* Today's Appointments */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">
                {selectedDate.toLocaleDateString('en-US', { 
                  weekday: 'long',
                  month: 'short', 
                  day: 'numeric' 
                })}
              </h3>
              
              {todayAppointments.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No appointments scheduled</p>
              ) : (
                <div className="space-y-3">
                  {todayAppointments.map(apt => (
                    <div key={apt.id} className="border rounded-lg p-3 hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Clock className="w-4 h-4 text-blue-600" />
                            <span className="font-medium">
                              {new Date(apt.date).toLocaleTimeString('en-US', {
                                hour: 'numeric',
                                minute: '2-digit',
                                hour12: true
                              })}
                            </span>
                            <span className={`px-2 py-1 rounded-full text-xs ${
                              apt.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                            }`}>
                              {apt.status}
                            </span>
                          </div>
                          <div className="text-sm text-gray-600 mb-1">
                            <User className="w-4 h-4 inline mr-1" />
                            {apt.customerName}
                          </div>
                          <div className="text-sm text-gray-600 mb-1">
                            <Phone className="w-4 h-4 inline mr-1" />
                            {apt.customerPhone}
                          </div>
                          <div className="text-sm text-gray-800 font-medium mb-1">
                            {apt.service}
                          </div>
                          <div className="text-sm text-gray-600">
                            {apt.issue}
                          </div>
                          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                            <span className="flex items-center gap-1">
                              <DollarSign className="w-3 h-3" />
                              ${apt.estimatedRevenue}
                            </span>
                            <span>via {apt.bookedVia}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Available Slots */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Available Slots</h3>
              <div className="grid grid-cols-2 gap-2">
                {availableSlots.slice(0, 8).map((slot, index) => (
                  <div 
                    key={index}
                    className="text-center py-2 px-3 bg-green-50 text-green-700 rounded border border-green-200 text-sm"
                  >
                    {slot.display}
                  </div>
                ))}
              </div>
              <div className="mt-3 text-xs text-gray-500 text-center">
                AI offers these slots to callers
              </div>
            </div>

            {/* Live Notifications */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Live Notifications</h3>
              <div className="space-y-3">
                {notifications.slice(0, 3).map(notification => (
                  <div key={notification.id} className={`p-3 rounded border-l-4 ${
                    notification.type === 'new_booking' ? 'border-blue-500 bg-blue-50' : 'border-orange-500 bg-orange-50'
                  }`}>
                    <div className="text-sm font-medium text-gray-900">
                      {notification.message}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {notification.time}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Daily Stats */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Today's Stats</h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-gray-600">Appointments:</span>
                  <span className="font-medium">{todayAppointments.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Revenue:</span>
                  <span className="font-medium text-green-600">
                    ${todayAppointments.reduce((sum, apt) => sum + apt.estimatedRevenue, 0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">AI Bookings:</span>
                  <span className="font-medium">
                    {todayAppointments.filter(apt => apt.bookedVia === 'AI Phone').length}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CalendarApp;
