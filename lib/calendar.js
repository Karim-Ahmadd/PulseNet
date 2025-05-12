import connection from './DB_connection';
import { tConvert } from './schedule_form';

async function buildCalendar(user_id){
try{
    const cal_events = [];
    const [cal_results] = await connection.query("Select start_time, end_time, DATE_FORMAT(date,'%Y-%m-%d') as date from doctor_calendar where doctor_id = ?", [user_id]);
    for(var i =0; i<cal_results.length; i++){
      const start_time = cal_results[i]["start_time"].substring(0,5);
      const end_time = cal_results[i]["end_time"].substring(0,5);
      cal_events.push({
        title: "Work from "+ tConvert(start_time) + " to "+ tConvert(end_time),
        start: cal_results[i]["date"]
      })
    }

    const [slots_results] = await connection.query("Select DATE_FORMAT(slot_date,'%Y-%m-%d') as slot_date, start_time, end_time, is_booked from appointment_slots where doctor_id = ? ", [user_id]);
    for(var i =0; i<slots_results.length; i++){
      const start_time = slots_results[i]["start_time"];
      const end_time = slots_results[i]["end_time"];
      cal_events.push({
        title: "Appointment",
        start: slots_results[i]["slot_date"] + "T"+ start_time,
        end: slots_results[i]["slot_date"] + "T"+ end_time
      });
      if(slots_results[i]["is_booked"]){
        cal_events[cal_events.length-1]["color"]= "red";
      }
    }
    return cal_events;
  }catch(e){
    console.log(e);
  }
}

export { buildCalendar };