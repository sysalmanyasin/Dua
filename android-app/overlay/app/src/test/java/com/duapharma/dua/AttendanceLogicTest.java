package com.duapharma.dua;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class AttendanceLogicTest {

    private static final String ID = "3f2c1a9e-1111-4222-8333-444455556666";

    @Test
    public void aGoodPlaceIsAccepted() {
        assertNull(AttendanceLogic.validateSite(ID, 31.5204, 74.3587, 100));
        assertNull(AttendanceLogic.validateSite(ID, -90, 180, 20));
        assertNull(AttendanceLogic.validateSite(ID, 90, -180, 2000));
    }

    @Test
    public void aBadPlaceIsRefused() {
        assertNotNull(AttendanceLogic.validateSite(null, 10, 20, 100));
        assertNotNull(AttendanceLogic.validateSite("x", 10, 20, 100));
        assertNotNull(AttendanceLogic.validateSite("not a uuid!!", 10, 20, 100));
        assertNotNull(AttendanceLogic.validateSite(ID, 91, 20, 100));
        assertNotNull(AttendanceLogic.validateSite(ID, 10, -181, 100));
        assertNotNull(AttendanceLogic.validateSite(ID, Double.NaN, 20, 100));
        assertNotNull(AttendanceLogic.validateSite(ID, 10, 20, 19));
        assertNotNull(AttendanceLogic.validateSite(ID, 10, 20, 2001));
    }

    @Test
    public void theStabilityPeriodHasTheDatabasesRange() {
        assertNull(AttendanceLogic.validateStable(30));
        assertNull(AttendanceLogic.validateStable(120));
        assertNull(AttendanceLogic.validateStable(600));
        assertNotNull(AttendanceLogic.validateStable(29));
        assertNotNull(AttendanceLogic.validateStable(601));
    }

    @Test
    public void transitionsHaveNames() {
        assertEquals("enter", AttendanceLogic.transitionName(1));
        assertEquals("exit", AttendanceLogic.transitionName(2));
        assertEquals("dwell", AttendanceLogic.transitionName(4));
        assertNull(AttendanceLogic.transitionName(0));
        assertNull(AttendanceLogic.transitionName(3));
        assertNull(AttendanceLogic.transitionName(8));
    }

    @Test
    public void requestIdsRoundTripAndForeignOnesAreIgnored() {
        assertEquals(ID, AttendanceLogic.siteIdOf(AttendanceLogic.requestId(ID)));
        assertNull(AttendanceLogic.siteIdOf(null));
        assertNull(AttendanceLogic.siteIdOf("other:" + ID));
        assertNull(AttendanceLogic.siteIdOf("dua:"));
        assertNull(AttendanceLogic.siteIdOf(ID));
    }

    @Test
    public void theFirstProblemIsReportedInTheOrderToFixThem() {
        assertNull(AttendanceLogic.problem(true, true, true, false));
        assertEquals("no_precise_location", AttendanceLogic.problem(false, false, false, true));
        assertEquals("location_off", AttendanceLogic.problem(true, false, false, true));
        assertEquals("no_background_location", AttendanceLogic.problem(true, false, true, true));
        assertEquals("background_restricted", AttendanceLogic.problem(true, true, true, true));
    }

    // ───── Phase 4: events ─────

    private static final String IN = "in";
    private static final String OUT = "out";

    @Test
    public void onlyOurOwnFunctionMayReceiveTheSecret() {
        assertTrue(AttendanceLogic.validEndpoint("https://sdsynzsflubdxnelgthh.supabase.co/functions/v1/attendance-event"));
        assertFalse(AttendanceLogic.validEndpoint("http://sdsynzsflubdxnelgthh.supabase.co/functions/v1/attendance-event"));
        assertFalse(AttendanceLogic.validEndpoint("https://evil.example.com/functions/v1/attendance-event"));
        assertFalse(AttendanceLogic.validEndpoint("https://sdsynzsflubdxnelgthh.supabase.co.evil.com/functions/v1/attendance-event"));
        assertFalse(AttendanceLogic.validEndpoint("https://sdsynzsflubdxnelgthh.supabase.co/functions/v1/widget-today"));
        assertFalse(AttendanceLogic.validEndpoint("https://sdsynzsflubdxnelgthh.supabase.co/functions/v1/attendance-event?x=1"));
        assertFalse(AttendanceLogic.validEndpoint(null));
    }

    @Test
    public void theSecretAndTheDeviceIdHaveTheirOwnShapes() {
        assertTrue(AttendanceLogic.validSecret("a".repeat(64)));
        assertFalse(AttendanceLogic.validSecret("A".repeat(64)));
        assertFalse(AttendanceLogic.validSecret("a".repeat(63)));
        assertFalse(AttendanceLogic.validSecret(null));
        assertTrue(AttendanceLogic.validDeviceId(ID));
        assertFalse(AttendanceLogic.validDeviceId("not-a-uuid"));
        assertFalse(AttendanceLogic.validDeviceId(null));
    }

    @Test
    public void distanceIsInMetres() {
        assertEquals(0.0, AttendanceLogic.distanceMetres(31.387139, 74.189924, 31.387139, 74.189924), 0.001);
        // 0.001 degree of latitude is about 111 m
        assertEquals(111.2, AttendanceLogic.distanceMetres(31.0, 74.0, 31.001, 74.0), 0.5);
        // one degree of longitude at 31 degrees north is about 95 km
        assertEquals(95300, AttendanceLogic.distanceMetres(31.0, 74.0, 31.0, 75.0), 300);
    }

    @Test
    public void anArrivalIsSentOnlyWithAGoodFixInsideThePlace() {
        assertEquals(AttendanceLogic.SEND, AttendanceLogic.decide(IN, 40, 12, 200, 100, false));
        assertEquals(AttendanceLogic.SEND, AttendanceLogic.decide(IN, 200, 100, 200, 100, false)); // exactly on the limits
        assertEquals(AttendanceLogic.RETRY, AttendanceLogic.decide(IN, 40, 250, 200, 100, false)); // weak fix: look again
        assertEquals(AttendanceLogic.RETRY, AttendanceLogic.decide(IN, 400, 12, 200, 100, false)); // outside: look again
        // on the last attempt it is sent anyway so the server records a refusal the owner can see
        assertEquals(AttendanceLogic.SEND, AttendanceLogic.decide(IN, 40, 250, 200, 100, true));
        assertEquals(AttendanceLogic.SEND, AttendanceLogic.decide(IN, 400, 12, 200, 100, true));
    }

    @Test
    public void aDepartureNeedsTheSameClearFixOutsideAfterTheStayPeriod() {
        assertEquals(AttendanceLogic.SEND, AttendanceLogic.decide(OUT, 350, 12, 200, 100, false));
        assertEquals(AttendanceLogic.CANCEL, AttendanceLogic.decide(OUT, 120, 12, 200, 100, false)); // came back: a flicker, nothing is sent
        assertEquals(AttendanceLogic.RETRY, AttendanceLogic.decide(OUT, 350, 250, 200, 100, false)); // outside but too weak: look again
        assertEquals(AttendanceLogic.RETRY, AttendanceLogic.decide(OUT, 120, 250, 200, 100, false)); // inside but too weak: look again
        assertEquals(AttendanceLogic.SEND, AttendanceLogic.decide(OUT, 350, 250, 200, 100, true)); // last try: the server records weak signal
        assertEquals(AttendanceLogic.CANCEL, AttendanceLogic.decide(OUT, 120, 250, 200, 100, true)); // last try, looks inside: never check out
    }

    @Test
    public void serverAnswersBecomeJournalLines() {
        assertEquals("recorded", AttendanceLogic.journalType("accepted"));
        assertEquals("refused", AttendanceLogic.journalType("rejected"));
        assertEquals("ignored", AttendanceLogic.journalType("ignored"));
        assertEquals("off", AttendanceLogic.journalType("off"));
        assertEquals("unknown", AttendanceLogic.journalType("something else"));
        assertEquals("unknown", AttendanceLogic.journalType(null));
    }

    @Test
    public void onlyADepartureWaitsForTheStayPeriod() {
        assertEquals(120, AttendanceLogic.confirmDelaySeconds(OUT, 120));
        assertEquals(30, AttendanceLogic.confirmDelaySeconds(OUT, 30));
        assertEquals(0, AttendanceLogic.confirmDelaySeconds(IN, 120));
        assertTrue(AttendanceLogic.validKind(IN) && AttendanceLogic.validKind(OUT));
        assertFalse(AttendanceLogic.validKind("sideways") || AttendanceLogic.validKind(null));
    }
}
